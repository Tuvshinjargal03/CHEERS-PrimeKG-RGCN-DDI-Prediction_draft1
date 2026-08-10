from pathlib import Path

import pandas as pd
import torch

from .rgcn_model import RGCNDDIModel


class DDIPredictor:

    def __init__(
        self,
        project_dir="/workspace/primekg_ddi_rgcn",
        device=None,
    ):

        self.project_dir = Path(
            project_dir
        )

        self.tensor_dir = (
            self.project_dir
            / "data/processed/rgcn_tensors"
        )

        self.mapping_dir = (
            self.project_dir
            / "data/processed/mappings"
        )

        self.checkpoint_path = (
            self.project_dir
            / "checkpoints/rgcn_multiseed"
            / "G3_seed44_best.pt"
        )


        # ----------------------------------------------------
        # Device
        # ----------------------------------------------------

        if device is None:

            self.device = torch.device(
                "cuda:0"
                if torch.cuda.is_available()
                else "cpu"
            )

        else:

            self.device = torch.device(
                device
            )


        # ----------------------------------------------------
        # Load final G3 graph
        # ----------------------------------------------------

        graph = torch.load(
            self.tensor_dir / "G3.pt",
            map_location="cpu"
        )

        self.edge_index = (
            graph["edge_index"]
            .to(self.device)
        )

        self.edge_type = (
            graph["edge_type"]
            .to(self.device)
        )

        self.num_nodes = int(
            graph["num_nodes"]
        )

        self.num_relations = int(
            graph["num_relations"]
        )

        if self.num_nodes != 13094:
            raise ValueError(
                "Unexpected node count."
            )

        if self.num_relations != 15:
            raise ValueError(
                "Unexpected relation count."
            )


        # ----------------------------------------------------
        # Candidate drugs
        # ----------------------------------------------------

        drug_obj = torch.load(
            self.tensor_dir
            / "drug_node_ids.pt",
            map_location="cpu"
        )

        self.drug_node_ids = (
            drug_obj["drug_node_ids"]
            .long()
        )

        if self.drug_node_ids.numel() != 4278:

            raise ValueError(
                "Expected 4,278 candidate drugs."
            )


        # ----------------------------------------------------
        # Known-positive DDI mask
        # ----------------------------------------------------

        known_obj = torch.load(
            self.tensor_dir
            / "ddi_known_positive_mask.pt",
            map_location="cpu"
        )

        self.known_positive_mask = (
            known_obj[
                "known_positive_mask"
            ]
            .bool()
        )

        mask_drug_ids = (
            known_obj[
                "drug_node_ids"
            ]
            .long()
        )

        if not torch.equal(
            self.drug_node_ids,
            mask_drug_ids
        ):

            raise ValueError(
                "Candidate drug mapping mismatch."
            )


        # ----------------------------------------------------
        # Verified drug metadata
        # ----------------------------------------------------

        self.drug_metadata = (
            pd.read_parquet(
                self.mapping_dir
                / "drug_metadata.parquet"
            )
        )

        if len(self.drug_metadata) != 4278:

            raise ValueError(
                "Expected 4,278 drug metadata rows."
            )

        if not self.drug_metadata[
            "node_id"
        ].is_unique:

            raise ValueError(
                "Drug node IDs are not unique."
            )

        self.metadata_lookup = (
            self.drug_metadata
            .set_index("node_id")
            .to_dict(orient="index")
        )


        # ----------------------------------------------------
        # Load final G3 Seed 44 checkpoint
        # ----------------------------------------------------

        checkpoint = torch.load(
            self.checkpoint_path,
            map_location=self.device
        )

        if checkpoint["graph"] != "G3":

            raise ValueError(
                "Expected G3 checkpoint."
            )

        if int(checkpoint["seed"]) != 44:

            raise ValueError(
                "Expected Seed 44 checkpoint."
            )

        state = checkpoint[
            "model_state_dict"
        ]

        embedding_dim = int(
            state[
                "node_embedding.weight"
            ].shape[1]
        )

        hidden_dim = int(
            state[
                "ddi_relation"
            ].shape[0]
        )

        self.model = RGCNDDIModel(
            num_nodes=self.num_nodes,
            num_relations=self.num_relations,
            embedding_dim=embedding_dim,
            hidden_dim=hidden_dim,
            dropout=0.2,
        ).to(self.device)

        self.model.load_state_dict(
            state
        )

        self.model.eval()

        self.graph_name = "G3"
        self.seed = 44
        self.best_epoch = int(
            checkpoint["best_epoch"]
        )


        # ----------------------------------------------------
        # Encode graph ONCE when predictor starts
        # ----------------------------------------------------

        with torch.no_grad():

            self.z = self.model.encode(
                self.edge_index,
                self.edge_type
            )

            self.drug_ids_gpu = (
                self.drug_node_ids
                .to(self.device)
            )

            self.candidate_z = self.z[
                self.drug_ids_gpu
            ]


    # ========================================================
    # Search
    # ========================================================

    def search_drugs(
        self,
        query,
        limit=20
    ):

        query = str(
            query
        ).strip()

        if not query:

            return []

        name_match = (
            self.drug_metadata[
                "entity_name"
            ]
            .astype(str)
            .str.contains(
                query,
                case=False,
                regex=False,
                na=False
            )
        )

        id_match = (
            self.drug_metadata[
                "entity_id"
            ]
            .astype(str)
            .str.casefold()
            == query.casefold()
        )

        result = (
            self.drug_metadata[
                name_match | id_match
            ]
            .copy()
        )

        result["_exact"] = (
            result[
                "entity_name"
            ]
            .astype(str)
            .str.casefold()
            == query.casefold()
        )

        result = (
            result
            .sort_values(
                ["_exact", "entity_name"],
                ascending=[False, True]
            )
            .head(limit)
        )

        return [
            {
                "name":
                    str(row.entity_name),

                "entity_id":
                    str(row.entity_id),

                "node_id":
                    int(row.node_id),
            }

            for row in result.itertuples()
        ]


    # ========================================================
    # Resolve exact drug
    # ========================================================

    def resolve_drug(
        self,
        query
    ):

        query = str(
            query
        ).strip()

        exact_name = (
            self.drug_metadata[
                "entity_name"
            ]
            .astype(str)
            .str.casefold()
            == query.casefold()
        )

        exact_id = (
            self.drug_metadata[
                "entity_id"
            ]
            .astype(str)
            .str.casefold()
            == query.casefold()
        )

        matches = self.drug_metadata[
            exact_name | exact_id
        ]

        if len(matches) == 0:

            suggestions = self.search_drugs(
                query,
                limit=10
            )

            raise ValueError(
                f"No exact drug found for '{query}'. "
                f"Suggestions: {suggestions}"
            )

        if len(matches) > 1:

            raise ValueError(
                f"Ambiguous exact query: '{query}'."
            )

        row = matches.iloc[0]

        return {
            "name":
                str(row["entity_name"]),

            "entity_id":
                str(row["entity_id"]),

            "node_id":
                int(row["node_id"]),

            "original_index":
                int(row["original_index"]),

            "source":
                str(row["entity_source"]),
        }


    # ========================================================
    # Predict unobserved candidate links
    # ========================================================

    @torch.no_grad()
    def predict(
        self,
        query,
        top_k=10
    ):

        top_k = int(
            top_k
        )

        if top_k < 1:

            raise ValueError(
                "top_k must be at least 1."
            )

        query_info = self.resolve_drug(
            query
        )

        query_node = query_info[
            "node_id"
        ]

        query_local = int(
            torch.searchsorted(
                self.drug_node_ids,
                torch.tensor(
                    query_node,
                    dtype=torch.long
                )
            ).item()
        )

        if (
            query_local
            >= self.drug_node_ids.numel()
            or int(
                self.drug_node_ids[
                    query_local
                ].item()
            )
            != query_node
        ):

            raise RuntimeError(
                "Drug node mapping failed."
            )


        # ----------------------------------------------------
        # Score all candidate drugs
        # ----------------------------------------------------

        query_z = self.z[
            query_node
        ]

        scores = (
            query_z
            @ (
                self.candidate_z
                * self.model.ddi_relation
            ).T
        )


        # ----------------------------------------------------
        # Filter known positives + self
        # ----------------------------------------------------

        known = (
            self.known_positive_mask[
                query_local
            ]
            .clone()
        )

        known_positive_count = int(
            known.sum().item()
        )

        filter_mask = known.clone()

        filter_mask[
            query_local
        ] = True

        available_count = int(
            (~filter_mask)
            .sum()
            .item()
        )

        actual_top_k = min(
            top_k,
            available_count
        )

        filtered_scores = (
            scores.clone()
        )

        filtered_scores[
            filter_mask.to(
                self.device
            )
        ] = float("-inf")


        top_scores, top_local = torch.topk(
            filtered_scores,
            k=actual_top_k
        )

        top_local_cpu = (
            top_local.cpu()
        )

        top_node_ids = (
            self.drug_node_ids[
                top_local_cpu
            ]
        )


        predictions = []

        for rank, (
            candidate_local,
            candidate_node,
            raw_score
        ) in enumerate(
            zip(
                top_local_cpu.tolist(),
                top_node_ids.tolist(),
                top_scores.cpu().tolist()
            ),
            start=1
        ):

            candidate_local = int(
                candidate_local
            )

            candidate_node = int(
                candidate_node
            )

            if candidate_node == query_node:

                raise RuntimeError(
                    "Self-pair escaped filtering."
                )

            if bool(
                self.known_positive_mask[
                    query_local,
                    candidate_local
                ].item()
            ):

                raise RuntimeError(
                    "Known positive escaped filtering."
                )

            meta = self.metadata_lookup[
                candidate_node
            ]

            predictions.append({
                "rank":
                    rank,

                "name":
                    str(
                        meta[
                            "entity_name"
                        ]
                    ),

                "entity_id":
                    str(
                        meta[
                            "entity_id"
                        ]
                    ),

                "node_id":
                    candidate_node,

                "raw_score":
                    float(
                        raw_score
                    ),

                "known_positive_in_primekg":
                    False,
            })


        return {
            "query":
                query_info,

            "model": {
                "graph":
                    self.graph_name,

                "seed":
                    self.seed,

                "best_epoch":
                    self.best_epoch,
            },

            "candidate_drug_count":
                int(
                    self.drug_node_ids
                    .numel()
                ),

            "known_positive_candidates_filtered":
                known_positive_count,

            "available_unobserved_candidates":
                available_count,

            "predictions":
                predictions,

            "disclaimer":
                (
                    "These are model-predicted unobserved "
                    "PrimeKG drug_drug candidate links. "
                    "They are not clinically validated "
                    "interactions and raw scores are not "
                    "probabilities."
                ),
        }
