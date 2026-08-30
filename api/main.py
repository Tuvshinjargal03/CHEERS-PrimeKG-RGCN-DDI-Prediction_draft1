"""
CHEERS Graduation Project API

Final research prototype:
Effect of Biomedical Knowledge Graph Composition on
R-GCN-Based Drug-Drug Interaction Prediction

The API exposes the final G3 / Seed 44 model for demonstration.

IMPORTANT:
Outputs are research-oriented link-prediction results.
They are not clinical recommendations or validated interaction
probabilities.
"""

from contextlib import asynccontextmanager
from pathlib import Path
import csv
import json

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.g3_context import G3ContextStore
from src.lightweight_inference import DDIPredictor
from src.pubmed_literature import PubMedLiteratureService
from src.safety_evidence import OpenFDALabelEvidenceService


# ============================================================
# Paths
# ============================================================

PROJECT_DIR = Path(__file__).resolve().parents[1]

FINAL_DIR = (
    PROJECT_DIR
    / "final_release"
)

RESULT_DIR = (
    PROJECT_DIR
    / "results/rgcn_multiseed"
)


# ============================================================
# Application lifecycle
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):

    print(
        "[CHEERS API] Loading verified G3 NumPy runtime..."
    )

    app.state.predictor = DDIPredictor(
        project_dir=PROJECT_DIR
    )

    app.state.context_store = G3ContextStore(
        project_dir=PROJECT_DIR
    )

    app.state.drug_metadata_by_id = {
        row["entity_id"].casefold(): {
            "drug_id": row["entity_id"],
            "drug_name": row["entity_name"],
            "drug_node_id": row["node_id"],
            "source": row["entity_source"],
        }
        for row in app.state.predictor.drug_metadata
    }

    app.state.label_evidence_service = OpenFDALabelEvidenceService()
    app.state.literature_service = PubMedLiteratureService()

    print(
        "[CHEERS API] Lightweight runtime and G3 context loaded successfully."
    )

    yield

    app.state.predictor = None
    app.state.context_store = None
    app.state.drug_metadata_by_id = None
    app.state.label_evidence_service = None
    app.state.literature_service = None


# ============================================================
# FastAPI application
# ============================================================

app = FastAPI(
    title="CHEERS PrimeKG R-GCN API",
    description=(
        "Research API for biomedical knowledge-graph "
        "composition analysis and R-GCN-based PrimeKG "
        "drug_drug link prediction."
    ),
    version="1.0.0",
    lifespan=lifespan,
)


# ============================================================
# CORS
#
# This supports a local standalone frontend during development.
# The final frontend can also be served from the same backend.
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "null",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Request schemas
# ============================================================

class PredictionRequest(BaseModel):

    drug: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description=(
            "Exact PrimeKG drug name or exact "
            "DrugBank identifier."
        ),
        examples=[
            "Colchicine",
            "DB01394",
        ],
    )

    top_k: int = Field(
        default=10,
        ge=1,
        le=50,
        description=(
            "Number of highest-ranked unobserved "
            "candidate links to return."
        ),
    )


# ============================================================
# Utility
# ============================================================

def load_json(path: Path):

    if not path.exists():

        raise FileNotFoundError(
            str(path)
        )

    with open(
        path,
        "r",
        encoding="utf-8"
    ) as f:

        return json.load(f)


def build_evidence_response(
    drug_a,
    drug_b,
    label_evidence,
    literature,
):
    """Keep external clinical evidence separate from AI prediction output."""

    return {
        "pair": {
            "drug_a": drug_a,
            "drug_b": drug_b,
        },
        "ai_context": {
            "note": (
                "Clinical evidence below is independent from the "
                "R-GCN prediction score."
            ),
        },
        "label_evidence": label_evidence,
        "literature": literature,
        "limitations": [
            (
                "External evidence retrieval is provided for research and "
                "educational use. Absence of retrieved evidence does not "
                "establish that a drug combination is safe."
            ),
            (
                "The R-GCN score predicts a PrimeKG drug-drug link and is "
                "not a clinical risk probability."
            ),
            (
                "openFDA label matching reports only explicit drug-name "
                "mentions in selected label sections and may miss synonyms, "
                "products, or records."
            ),
            (
                "PubMed retrieval is a conservative name-based search and "
                "is not a systematic review."
            ),
        ],
    }


# ============================================================
# Root
# ============================================================

@app.get("/api")
def root():

    return {
        "project": (
            "Effect of Biomedical Knowledge Graph "
            "Composition on R-GCN-Based "
            "Drug-Drug Interaction Prediction"
        ),

        "team":
            "CHEERS",

        "status":
            "running",

        "version":
            "1.0.0",

        "api_endpoints": {
            "health":
                "/api/health",

            "model":
                "/api/model",

            "experiment":
                "/api/experiment",

            "relation_analysis":
                "/api/relation-analysis",

            "verification":
                "/api/verification",

            "drug_search":
                "/api/drugs/search?q=Colchi",

            "prediction":
                "POST /api/predict",

            "pair_context":
                (
                    "/api/context/pair"
                    "?drug_a_id=DB01394"
                    "&drug_b_id=DB01032"
                ),

            "pair_evidence":
                (
                    "/api/evidence/pair"
                    "?drug_a_id=DB01394"
                    "&drug_b_id=DB01032"
                ),

            "swagger":
                "/docs",
        },

        "disclaimer": (
            "Research prototype only. "
            "Not for clinical decision-making."
        ),
    }


# ============================================================
# Health
# ============================================================

@app.get("/api/health")
def health():

    predictor = app.state.predictor

    return {
        "status":
            "ok",

        "model_loaded":
            predictor is not None,

        "device":
            str(
                predictor.device
            ),

        "graph_variant":
            predictor.graph_name,

        "seed":
            predictor.seed,

        "best_epoch":
            predictor.best_epoch,

        "candidate_drugs":
            int(
                predictor.drug_node_ids.size
            ),
    }


# ============================================================
# Model information
# ============================================================

@app.get("/api/model")
def model_information():

    predictor = app.state.predictor

    return {
        "architecture":
            "2-layer R-GCN",

        "decoder":
            "symmetric DistMult-style bilinear decoder",

        "graph_variant":
            predictor.graph_name,

        "graph_composition": {
            "DDI":
                True,

            "Drug-Gene/Protein":
                True,

            "Drug-Disease":
                True,
        },

        "seed":
            predictor.seed,

        "best_epoch":
            predictor.best_epoch,

        "num_nodes":
            predictor.num_nodes,

        "num_relations":
            predictor.num_relations,

        "candidate_drugs":
            int(
                predictor.drug_node_ids.size
            ),

        "embedding_dim":
            128,

        "hidden_dim":
            128,

        "target_relation": {
            "primekg_relation":
                "drug_drug",

            "primekg_display_relation":
                "synergistic interaction",
        },

        "demo_checkpoint":
            "G3_seed44_best.pt",

        "disclaimer": (
            "Raw model scores are ranking scores, "
            "not probabilities."
        ),
    }


# ============================================================
# Final experiment results
# ============================================================

@app.get("/api/experiment")
def experiment_results():

    summary_path = (
        PROJECT_DIR
        / "results/live_5seed"
        / "final_experiment_summary.json"
    )

    try:

        summary = load_json(
            summary_path
        )

    except FileNotFoundError:

        raise HTTPException(
            status_code=500,
            detail=(
                "Final experiment summary "
                "file is unavailable."
            ),
        )

    return {
        "summary":
            summary,

        "primary_finding": {
            "best_graph":
                "G3",

            "composition":
                (
                    "DDI + Drug-Gene/Protein "
                    "+ Drug-Disease"
                ),

            "five_seed_mrr":
                "0.5342 ± 0.0063",

            "baseline_G0_mrr":
                "0.5273 ± 0.0064",

            "absolute_mrr_gain":
                0.006924,

            "relative_mrr_gain_percent":
                1.31,

            "consistency":
                (
                    "G3 exceeded G0 in all "
                    "five seeds across MRR, "
                    "Hits@1, Hits@5, and Hits@10."
                ),
        },

        "reporting_note": (
            "Five seeds provide robustness evidence, "
            "but statistical significance is not claimed."
        ),
    }


# ============================================================
# Complementary classification metrics
# ============================================================

@app.get("/api/classification")
def classification_results():

    summary_path = (
        PROJECT_DIR
        / "results/classification_metrics_5seed"
        / "classification_metrics_5seed_summary.json"
    )

    try:

        summary = load_json(
            summary_path
        )

    except FileNotFoundError:

        raise HTTPException(
            status_code=500,
            detail=(
                "Classification metrics summary "
                "file is unavailable."
            ),
        )

    return {
        "summary": summary,
        "interpretation": (
            "Accuracy, Precision, Recall, and F1 are reported as "
            "complementary binary discrimination metrics. "
            "MRR and Hits@K remain the primary link-ranking metrics."
        ),
        "negative_class_note": (
            "Negative examples are sampled unobserved DDI pairs, "
            "not confirmed non-interactions."
        ),
        "threshold_note": (
            "The classification threshold is selected separately "
            "for each graph and seed by maximizing validation F1, "
            "then frozen for test evaluation."
        ),
    }


# ============================================================
# Secondary relation-level analysis
# ============================================================

@app.get("/api/relation-analysis")
def relation_analysis_results():
    """Return the frozen three-seed single-relation follow-up analysis."""

    result_dir = (
        PROJECT_DIR
        / "results/relation_ablation/final"
    )
    summary_path = (
        result_dir
        / "relation_ablation_3seed_summary.csv"
    )
    paired_path = (
        result_dir
        / "relation_ablation_paired_deltas_vs_G0.csv"
    )

    try:
        with summary_path.open(
            "r",
            encoding="utf-8-sig",
            newline="",
        ) as summary_file:
            summary_rows = list(
                csv.DictReader(summary_file)
            )

        with paired_path.open(
            "r",
            encoding="utf-8-sig",
            newline="",
        ) as paired_file:
            paired_rows = list(
                csv.DictReader(paired_file)
            )

    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Relation-ablation result artifact "
                f"is unavailable: {exc.filename}"
            ),
        )

    if not summary_rows:
        raise HTTPException(
            status_code=500,
            detail="Relation-ablation summary contains no data rows.",
        )

    summary_rows.sort(
        key=lambda row: float(row["DeltaMRR_mean"]),
        reverse=True,
    )

    family_by_graph = {
        "A1_target": "Drug-Gene/Protein",
        "A2_enzyme": "Drug-Gene/Protein",
        "A3_transporter": "Drug-Gene/Protein",
        "A4_carrier": "Drug-Gene/Protein",
        "A5_indication": "Drug-Disease",
        "A6_contraindication": "Drug-Disease",
        "A7_off_label": "Drug-Disease",
    }

    deltas_by_graph = {}
    for row in paired_rows:
        graph = row["graph"]
        deltas_by_graph.setdefault(graph, []).append({
            "seed": int(row["seed"]),
            "relation_mrr": float(row["relation_MRR"]),
            "g0_mrr": float(row["G0_MRR"]),
            "delta_mrr": float(row["delta_MRR"]),
        })

    results = []
    for rank, row in enumerate(summary_rows, start=1):
        graph = row["graph"]
        if graph not in family_by_graph:
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected relation-ablation graph: {graph}.",
            )
        seed_deltas = sorted(
            deltas_by_graph.get(graph, []),
            key=lambda item: item["seed"],
        )
        if len(seed_deltas) != 3:
            raise HTTPException(
                status_code=500,
                detail=f"Expected three paired seed rows for {graph}.",
            )

        wins = int(row["PositiveSeeds"])
        results.append({
            "rank": rank,
            "graph": graph,
            "relation": row["Relation"],
            "family": family_by_graph[graph],
            "biomedical_edges": int(row["BiomedicalEdges"]),
            "biomedical_directed_edges": int(row["BiomedicalDirectedEdges"]),
            "mrr_mean": float(row["MRR_mean"]),
            "mrr_std": float(row["MRR_std"]),
            "delta_mrr_mean": float(row["DeltaMRR_mean"]),
            "delta_mrr_std": float(row["DeltaMRR_std"]),
            "delta_mrr_min": float(row["DeltaMRR_min"]),
            "delta_mrr_max": float(row["DeltaMRR_max"]),
            "wins_vs_g0": wins,
            "losses_vs_g0": 3 - wins,
            "seed_deltas": seed_deltas,
        })

    return {
        "study_type": "secondary follow-up analysis",
        "construction": (
            "Each variant retains the G0 DDI-only backbone and adds "
            "one biomedical relation together with its reverse edges."
        ),
        "seeds": [42, 43, 44],
        "baseline": {
            "graph": "G0",
            "mrr_mean": float(summary_rows[0]["G0_MRR_mean"]),
            "mrr_std": float(summary_rows[0]["G0_MRR_std"]),
        },
        "results": results,
        "caveat": (
            "Only three seeds were evaluated. These results show relative "
            "trends and do not establish statistical significance."
        ),
    }



# ============================================================
# Final verification record
# ============================================================

@app.get("/api/verification")
def verification_results():

    verification_path = (
        FINAL_DIR
        / "FINAL_VERIFICATION_SUMMARY.json"
    )

    try:

        verification = load_json(
            verification_path
        )

    except FileNotFoundError:

        raise HTTPException(
            status_code=500,
            detail=(
                "Final verification summary "
                "file is unavailable."
            ),
        )

    return verification


# ============================================================
# Drug search
# ============================================================

@app.get("/api/drugs/search")
def search_drugs(
    q: str = Query(
        ...,
        min_length=1,
        max_length=200,
        description=(
            "Partial drug name or exact "
            "DrugBank identifier."
        ),
    ),

    limit: int = Query(
        default=10,
        ge=1,
        le=50,
    ),
):

    predictor = app.state.predictor

    results = predictor.search_drugs(
        query=q,
        limit=limit,
    )

    return {
        "query":
            q,

        "count":
            len(results),

        "results":
            results,
    }


# ============================================================
# Prediction
# ============================================================

@app.post("/api/predict")
def predict(
    request: PredictionRequest
):

    predictor = app.state.predictor

    try:

        result = predictor.predict(
            query=request.drug,
            top_k=request.top_k,
        )

    except ValueError as exc:

        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )

    except RuntimeError as exc:

        raise HTTPException(
            status_code=500,
            detail=(
                "Inference integrity check "
                f"failed: {exc}"
            ),
        )

    return result


# ============================================================
# G3 pair context
# ============================================================

@app.get("/api/context/pair")
def pair_context(
    drug_a_id: str = Query(
        ...,
        min_length=1,
        max_length=100,
        description="Exact DrugBank ID for the query drug.",
    ),
    drug_b_id: str = Query(
        ...,
        min_length=1,
        max_length=100,
        description="Exact DrugBank ID for the candidate drug.",
    ),
):

    context_store = app.state.context_store

    try:

        return context_store.get_pair_context(
            drug_a_id=drug_a_id,
            drug_b_id=drug_b_id,
        )

    except KeyError as exc:

        raise HTTPException(
            status_code=404,
            detail=exc.args[0],
        )


# ============================================================
# Independent FDA label and PubMed pair evidence
# ============================================================

@app.get("/api/evidence/pair")
def pair_evidence(
    drug_a_id: str = Query(
        ...,
        min_length=1,
        max_length=100,
        description="Exact DrugBank ID for the first drug.",
    ),
    drug_b_id: str = Query(
        ...,
        min_length=1,
        max_length=100,
        description="Exact DrugBank ID for the second drug.",
    ),
):
    metadata_by_id = app.state.drug_metadata_by_id
    drug_a = metadata_by_id.get(drug_a_id.strip().casefold())
    drug_b = metadata_by_id.get(drug_b_id.strip().casefold())

    if drug_a is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown drug ID: {drug_a_id}.",
        )
    if drug_b is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown drug ID: {drug_b_id}.",
        )

    label_evidence = app.state.label_evidence_service.get_pair_evidence(
        drug_a_name=drug_a["drug_name"],
        drug_b_name=drug_b["drug_name"],
    )
    literature = app.state.literature_service.search_pair(
        drug_a_name=drug_a["drug_name"],
        drug_b_name=drug_b["drug_name"],
    )

    return build_evidence_response(
        drug_a=drug_a,
        drug_b=drug_b,
        label_evidence=label_evidence,
        literature=literature,
    )


# ============================================================
# Web application
# ============================================================

WEB_DIR = (
    PROJECT_DIR
    / "web"
)

app.mount(
    "/static",
    StaticFiles(
        directory=str(WEB_DIR)
    ),
    name="static",
)


@app.get(
    "/",
    include_in_schema=False
)
def web_application():

    return FileResponse(
        WEB_DIR
        / "index.html"
    )
