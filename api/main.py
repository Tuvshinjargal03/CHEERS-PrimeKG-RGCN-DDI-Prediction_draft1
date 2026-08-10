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
import json

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.g3_context import G3ContextStore
from src.lightweight_inference import DDIPredictor


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

    print(
        "[CHEERS API] Lightweight runtime and G3 context loaded successfully."
    )

    yield

    app.state.predictor = None
    app.state.context_store = None


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
        RESULT_DIR
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

            "three_seed_mrr":
                "0.5388 ± 0.0014",

            "baseline_G0_mrr":
                "0.5292 ± 0.0082",

            "absolute_mrr_gain":
                0.009592,

            "relative_mrr_gain_percent":
                1.81,

            "consistency":
                (
                    "G3 exceeded G0 in all "
                    "three seeds across MRR, "
                    "Hits@1, Hits@5, and Hits@10."
                ),
        },

        "reporting_note": (
            "Three seeds provide robustness evidence, "
            "but statistical significance is not claimed."
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
