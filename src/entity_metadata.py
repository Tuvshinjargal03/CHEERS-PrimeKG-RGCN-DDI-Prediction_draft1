"""Read-only access to optional supplemental entity metadata."""

from __future__ import annotations

from copy import deepcopy
import json
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

    def __len__(self):
        return len(self._records)


__all__ = ["EntityMetadataStore"]
