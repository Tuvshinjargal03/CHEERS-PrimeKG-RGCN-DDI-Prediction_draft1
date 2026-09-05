"""Read-only access to optional supplemental entity metadata."""

from __future__ import annotations

from copy import deepcopy
import json
import hashlib
from pathlib import Path
from types import MappingProxyType


class EntityMetadataStore:
    """Index validated derived metadata by exact entity type and entity ID."""

    REQUIRED_IDENTITY_FIELDS = {
        "graph_node_id",
        "entity_id",
        "entity_type",
        "display_name",
        "source",
        "metadata",
    }
    REQUIRED_METADATA_FIELDS = {
        "matched",
        "ncbi_gene_id",
        "official_symbol",
        "official_full_name",
        "aliases",
        "taxonomy_id",
        "organism",
        "summary",
        "summary_source",
        "summary_date",
        "source_modified_date",
        "record_status",
        "replacement_gene_id",
    }

    def __init__(self, records=None, record_count=0, enabled=False):
        self._records = MappingProxyType(dict(records or {}))
        self.record_count = int(record_count)
        self.enabled = bool(enabled)

    @classmethod
    def empty(cls):
        """Return a disabled store for portable runtimes without the artifact."""
        return cls()

    @classmethod
    def load(cls, path: Path):
        """Load the derived JSONL artifact; no raw NCBI data or network is used."""
        path = Path(path)
        records = {}
        record_count = 0
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    raise ValueError(f"Blank entity metadata line {line_number}.")
                record = json.loads(line)
                if not isinstance(record, dict) or not cls.REQUIRED_IDENTITY_FIELDS.issubset(record):
                    raise ValueError(f"Entity metadata line {line_number} is incomplete.")
                entity_type = record["entity_type"]
                entity_id = record["entity_id"]
                if entity_type != "gene/protein" or not isinstance(entity_id, str):
                    raise ValueError(f"Entity metadata line {line_number} has invalid identity.")
                if not entity_id.isascii() or not entity_id.isdigit():
                    raise ValueError(f"Entity metadata line {line_number} has invalid GeneID.")
                metadata = record["metadata"]
                if not isinstance(metadata, dict) or set(metadata) != cls.REQUIRED_METADATA_FIELDS:
                    raise ValueError(f"Entity metadata line {line_number} has invalid metadata fields.")
                if not isinstance(metadata["matched"], bool) or not isinstance(metadata["aliases"], list):
                    raise ValueError(f"Entity metadata line {line_number} has invalid metadata types.")
                if metadata["matched"] and metadata["ncbi_gene_id"] != entity_id:
                    raise ValueError(f"Entity metadata line {line_number} is not an exact GeneID match.")
                key = (entity_type, entity_id)
                if key in records:
                    raise ValueError(f"Duplicate entity metadata key: {key!r}.")
                record_count += 1
                if metadata["matched"]:
                    records[key] = deepcopy(metadata)
        return cls(records=records, record_count=record_count, enabled=True)

    def get(self, entity_type: str, entity_id: str):
        """Return a copy of an exact match so callers cannot mutate the store."""
        metadata = self._records.get((entity_type, entity_id))
        return deepcopy(metadata) if metadata is not None else None

    @classmethod
    def load_descriptions(cls, path, manifest_path, inventory_path, project_dir):
        """Load optional context with exact inventory identities and manifest checks."""
        path, manifest_path = Path(path), Path(manifest_path)
        if not path.exists() and not manifest_path.exists():
            return cls.empty()
        manifest = json.loads(manifest_path.read_bytes())
        relative = path.relative_to(project_dir).as_posix()
        expected = manifest['outputs'][relative]
        raw = path.read_bytes()
        if len(raw) != expected['byte_size'] or hashlib.sha256(raw).hexdigest() != expected['sha256']:
            raise ValueError('Description fingerprint mismatch')
        if not raw.endswith(b'\n') or b'\r' in raw:
            raise ValueError('Description newline mismatch')
        rows = [json.loads(line) for line in raw.decode('utf-8').splitlines()]
        kind = 'drug' if path.name == 'drug_descriptions.jsonl' else 'disease'
        inventory = [json.loads(line) for line in Path(inventory_path).read_text(encoding='utf-8').splitlines()]
        identities = [r for r in inventory if r['entity_type'] == kind]
        if len(rows) != expected['record_count'] or len(rows) != len(identities):
            raise ValueError('Description count mismatch')
        records = {}
        fields = {'description', 'status', 'reason_codes', 'source', 'source_id',
                  'source_release', 'evidence', 'license'}
        for row, identity in zip(rows, identities):
            if set(row) != set(identity) | {'metadata'} or any(row[k] != v for k, v in identity.items()):
                raise ValueError('Description exact identity/order mismatch')
            metadata = row['metadata']
            if not isinstance(metadata, dict) or set(metadata) != fields:
                raise ValueError('Invalid description schema')
            if metadata['status'] not in {'approved', 'needs_review', 'unresolved', 'rejected'}:
                raise ValueError('Invalid description status')
            reasons = metadata['reason_codes']
            if not isinstance(reasons, list) or any(not isinstance(r, str) for r in reasons) or len(set(reasons)) != len(reasons):
                raise ValueError('Invalid description reasons')
            if metadata['status'] == 'approved' and reasons:
                raise ValueError('Approved description has review reasons')
            expected_source = 'ChEMBL 37' if kind == 'drug' else 'MONDO'
            expected_license = 'CC BY-SA 3.0' if kind == 'drug' else 'CC BY 4.0'
            if metadata['source'] != expected_source or metadata['license'] != expected_license:
                raise ValueError('Invalid description attribution')
            if metadata['description'] is not None and (metadata['status'] != 'approved'
                    or not isinstance(metadata['description'], str) or not metadata['description']):
                raise ValueError('Unsafe description status/type')
            if kind == 'disease' and identity['source'] == 'MONDO_grouped' and metadata['description'] is not None:
                raise ValueError('Grouped definition forbidden')
            key = (kind, identity['entity_id'])
            if key in records:
                raise ValueError('Duplicate description identity')
            records[key] = deepcopy(metadata)
        return cls(records, len(rows), True)

    def combined(self, other):
        if self._records.keys() & other._records.keys():
            raise ValueError('Duplicate metadata across stores')
        return type(self)({**self._records, **other._records},
                          self.record_count + other.record_count, self.enabled or other.enabled)

    def __len__(self):
        return len(self._records)


__all__ = ["EntityMetadataStore"]
