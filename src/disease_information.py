"""Public disease profiles and typed medicine relationships from frozen data."""

from __future__ import annotations

import csv
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from src.entity_metadata import EntityMetadataStore


class DiseaseInformationService:
    """Read approved disease descriptions and typed G3 medicine relationships."""

    EXPECTED_DISEASES = 2_010
    EXPECTED_NUTRITION_DISEASE_IDS = frozenset({"5148", "5393", "1356"})
    NUTRITION_SCHEMA_VERSION = 1
    NUTRITION_ARTIFACT_PATH = (
        "final_release/disease_nutrition_runtime/disease_nutrition.jsonl"
    )

    def __init__(self, project_dir=None):
        if project_dir is None:
            project_dir = Path(__file__).resolve().parents[1]
        self.project_dir = Path(project_dir).resolve()
        runtime = self.project_dir / "final_release"
        metadata_runtime = runtime / "entity_metadata_runtime"

        description_store = EntityMetadataStore.load_descriptions(
            metadata_runtime / "disease_descriptions.jsonl",
            metadata_runtime / "DISEASE_DESCRIPTIONS_MANIFEST.json",
            metadata_runtime / "entity_description_inventory.jsonl",
            self.project_dir,
        )
        self.diseases = self._load_diseases(
            metadata_runtime / "entity_description_inventory.jsonl",
            description_store,
        )
        self.nutrition_lifestyle = self._load_nutrition_lifestyle(
            runtime / "disease_nutrition_runtime" / "disease_nutrition.jsonl",
            runtime
            / "disease_nutrition_runtime"
            / "DISEASE_NUTRITION_MANIFEST.json",
            self.diseases,
        )
        candidate_drugs = self._load_candidate_drugs(
            runtime / "lightweight_runtime" / "drug_metadata.csv"
        )
        self.relationships = self._load_relationships(
            runtime / "g3_context_runtime" / "g3_drug_context.csv",
            candidate_drugs,
        )

        if len(self.diseases) != self.EXPECTED_DISEASES:
            raise ValueError(f"Expected {self.EXPECTED_DISEASES:,} disease entities.")

    @staticmethod
    def _load_diseases(inventory_path, description_store):
        diseases = {}
        with Path(inventory_path).open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    raise ValueError(f"Blank entity inventory line {line_number}.")
                row = json.loads(line)
                if row.get("entity_type") != "disease":
                    continue
                metadata = description_store.get("disease", row["entity_id"])
                if metadata is None:
                    raise ValueError(
                        f"Disease description metadata is missing for {row['entity_id']}."
                    )
                approved = metadata["status"] == "approved" and bool(metadata["description"])
                disease = {
                    "entity_id": row["entity_id"],
                    "name": row["display_name"],
                    "node_id": int(row["graph_node_id"]),
                    "source": row["source"],
                    "verified_description_available": approved,
                    "description_status": metadata["status"],
                }
                if approved:
                    disease["description"] = metadata["description"]
                    disease["description_provenance"] = {
                        "source": metadata["source"],
                        "source_id": metadata["source_id"],
                        "license": metadata["license"],
                    }
                diseases[row["entity_id"].casefold()] = disease
        return diseases

    @classmethod
    def _load_nutrition_lifestyle(cls, artifact_path, manifest_path, diseases):
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        if manifest.get("schema_version") != cls.NUTRITION_SCHEMA_VERSION:
            raise ValueError("Unexpected disease nutrition manifest schema version.")
        if manifest.get("not_personalized") is not True:
            raise ValueError("Disease nutrition manifest must be non-personalized.")

        output = manifest.get("outputs", {}).get(cls.NUTRITION_ARTIFACT_PATH)
        if output is None:
            raise ValueError("Disease nutrition manifest output is missing.")

        raw_artifact = Path(artifact_path).read_bytes()
        if len(raw_artifact) != output.get("byte_size"):
            raise ValueError("Disease nutrition artifact byte size does not match manifest.")
        if hashlib.sha256(raw_artifact).hexdigest() != output.get("sha256"):
            raise ValueError("Disease nutrition artifact SHA-256 does not match manifest.")

        records = {}
        for line_number, line in enumerate(
            raw_artifact.decode("utf-8").splitlines(), start=1
        ):
            if not line.strip():
                raise ValueError(f"Blank disease nutrition line {line_number}.")
            record = json.loads(line)
            disease_id = str(record.get("cheers_disease_id", "")).strip()
            key = disease_id.casefold()
            if key in records:
                raise ValueError(f"Duplicate disease nutrition record: {disease_id}.")
            disease = diseases.get(key)
            if disease is None:
                raise ValueError(f"Unknown disease nutrition ID: {disease_id}.")
            if record.get("schema_version") != cls.NUTRITION_SCHEMA_VERSION:
                raise ValueError(f"Unexpected nutrition schema for disease {disease_id}.")
            if record.get("mapping_status") != "reviewed":
                raise ValueError(f"Unreviewed disease nutrition mapping: {disease_id}.")
            if record.get("not_personalized") is not True:
                raise ValueError(f"Personalized disease nutrition record: {disease_id}.")
            if record.get("canonical_disease_name") != disease["name"]:
                raise ValueError(f"Disease nutrition name mismatch: {disease_id}.")

            for field in (
                "general_guidance",
                "foods_emphasized",
                "foods_limited",
                "relevant_nutrients",
            ):
                items = record.get(field)
                if not isinstance(items, list):
                    raise ValueError(f"Invalid {field} for disease {disease_id}.")
                if any(
                    not isinstance(item, dict)
                    or not item.get("text")
                    or not item.get("source_section")
                    for item in items
                ):
                    raise ValueError(f"Untraceable {field} item for disease {disease_id}.")

            source = record.get("source", {})
            if any(
                not source.get(field)
                for field in ("organization", "page_title", "url", "source_date")
            ):
                raise ValueError(f"Incomplete nutrition source for disease {disease_id}.")
            records[key] = record

        expected_count = output.get("record_count")
        if len(records) != expected_count or len(records) != manifest.get("record_count"):
            raise ValueError("Disease nutrition record count does not match manifest.")
        if set(records) != cls.EXPECTED_NUTRITION_DISEASE_IDS:
            raise ValueError("Unexpected supported disease nutrition identities.")
        if set(manifest.get("supported_disease_ids", [])) != set(records):
            raise ValueError("Disease nutrition manifest identities do not match artifact.")
        return records

    @staticmethod
    def _load_candidate_drugs(path):
        with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
            return {
                row["entity_id"].strip().casefold(): {
                    "drug_id": row["entity_id"].strip(),
                    "drug_name": row["entity_name"].strip(),
                    "drug_node_id": int(row["node_id"]),
                    "source": row["entity_source"].strip(),
                }
                for row in csv.DictReader(handle)
            }

    @staticmethod
    def _load_relationships(path, candidate_drugs):
        grouped = {}
        seen = set()
        with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                if row["context_group"] != "disease":
                    continue
                drug = candidate_drugs.get(row["drug_id"].strip().casefold())
                if drug is None:
                    continue
                disease_key = row["context_id"].strip().casefold()
                relation = row["relation"].strip()
                dedupe_key = (disease_key, drug["drug_id"], relation)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                grouped.setdefault(disease_key, []).append(
                    {
                        **drug,
                        "relation": relation,
                        "context_source": row["context_source"].strip(),
                    }
                )

        for relationships in grouped.values():
            relationships.sort(
                key=lambda item: (
                    item["relation"] != "indication",
                    item["relation"],
                    item["drug_name"].casefold(),
                    item["drug_id"],
                )
            )
        return grouped

    def get_disease_information(self, disease_id):
        key = str(disease_id).strip().casefold()
        disease = self.diseases.get(key)
        if disease is None:
            raise KeyError(f"Unknown disease ID: {disease_id}.")

        relationships = self.relationships.get(key, [])
        indications = [item for item in relationships if item["relation"] == "indication"]
        other = [item for item in relationships if item["relation"] != "indication"]
        nutrition_record = self.nutrition_lifestyle.get(key)
        if nutrition_record is None:
            nutrition_lifestyle = {"status": "unavailable"}
        else:
            nutrition_lifestyle = {
                "status": "available",
                "general_guidance": deepcopy(nutrition_record["general_guidance"]),
                "foods_emphasized": deepcopy(nutrition_record["foods_emphasized"]),
                "foods_limited": deepcopy(nutrition_record["foods_limited"]),
                "relevant_nutrients": deepcopy(nutrition_record["relevant_nutrients"]),
                "source": deepcopy(nutrition_record["source"]),
                "disease_mapping": deepcopy(nutrition_record["disease_mapping"]),
                "cheers_reviewed_date": nutrition_record["cheers_reviewed_date"],
                "not_personalized": True,
                "scope_note": (
                    "General disease nutrition education only; not medical nutrition "
                    "therapy or personalized diet advice."
                ),
            }
        return {
            "disease": disease,
            "medicine_relationships": {
                "indications": indications,
                "other": other,
                "total": len(relationships),
            },
            "nutrition_lifestyle": nutrition_lifestyle,
            "relationship_scope": (
                "Indication relationships are graph/source associations, not personalized "
                "prescriptions. Other relationship types are kept separate."
            ),
        }


__all__ = ["DiseaseInformationService"]
