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

from src.entity_metadata import EntityMetadataStore
from src.g3_context import G3ContextStore
from src.graph_neighborhood import GraphNeighborhoodStore
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

GENE_METADATA_PATH = (
    FINAL_DIR
    / "entity_metadata_runtime"
    / "gene_metadata.jsonl"
)


def load_entity_metadata_store(path=GENE_METADATA_PATH):
    try:
        store = EntityMetadataStore.load(path)
    except FileNotFoundError:
        print(
            "[CHEERS API] WARNING: Optional gene metadata artifact is absent; "
            "gene neighborhoods will use graph identity only."
        )
        return EntityMetadataStore.empty()
    print(
        f"[CHEERS API] Loaded {len(store):,} exact gene metadata records "
        f"from {store.record_count:,} artifact rows."
    )
    return store


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

    app.state.entity_metadata_store = load_entity_metadata_store()

    app.state.neighborhood_store = GraphNeighborhoodStore(
        context_store=app.state.context_store,
        project_dir=PROJECT_DIR,
        entity_metadata_store=app.state.entity_metadata_store,
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
    app.state.entity_metadata_store = None
    app.state.neighborhood_store = None
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


class DrugTextMatchRequest(BaseModel):

    text: str = Field(
        ...,
        min_length=1,
        max_length=20_000,
        description="OCR-extracted printed text to match against supported drugs.",
    )

    limit: int = Field(
        default=10,
        ge=1,
        le=20,
        description="Maximum number of conservative supported-drug matches.",
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

            "classification":
                "/api/classification",

            "relation_analysis":
                "/api/relation-analysis",

            "verification":
                "/api/verification",

            "drug_search":
                "/api/drugs/search?q=Colchi",

            "drug_text_match":
                "POST /api/drugs/match-text",

            "prediction":
                "POST /api/predict",

            "pair_context":
                (
                    "/api/context/pair"
                    "?drug_a_id=DB01394"
                    "&drug_b_id=DB01032"
                ),

            "drug_context":
                "/api/context/drug?drug_id=DB01394",

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

    primary_result = summary["primary_result"]
    best_graph = primary_result["best_graph"]
    baseline_graph = "G0"
    metric_summary = summary["final_results_mean_std"]
    best_mrr = metric_summary[best_graph]["MRR"]
    baseline_mrr = metric_summary[baseline_graph]["MRR"]
    evaluated_metrics = summary["evaluation"]["metrics"]
    metric_list = ", ".join(evaluated_metrics[:-1])
    metric_list += f", and {evaluated_metrics[-1]}"

    return {
        "summary":
            summary,

        "primary_finding": {
            "best_graph":
                best_graph,

            "composition":
                summary["graph_variants"][best_graph],

            "five_seed_mrr":
                (
                    f"{best_mrr['mean']:.4f} "
                    f"± {best_mrr['std']:.4f}"
                ),

            "baseline_G0_mrr":
                (
                    f"{baseline_mrr['mean']:.4f} "
                    f"± {baseline_mrr['std']:.4f}"
                ),

            "absolute_mrr_gain":
                primary_result[
                    "absolute_MRR_improvement_vs_G0"
                ],

            "relative_mrr_gain_percent":
                primary_result[
                    "relative_MRR_improvement_percent"
                ],

            "consistency":
                (
                    f"{best_graph} exceeded {baseline_graph} in "
                    f"{primary_result['seeds_beating_G0']} matched "
                    f"seeds across {metric_list}."
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
    """Return the current five-seed study and labeled three-seed history."""

    result_root = PROJECT_DIR / "results/relation_ablation"
    statistics_path = result_root / "five_seed_v1/statistics.json"
    history_path = result_root / "final/relation_ablation_3seed_summary.csv"

    try:
        statistics = load_json(statistics_path)
        with history_path.open(
            "r", encoding="utf-8-sig", newline=""
        ) as history_file:
            history_rows = list(csv.DictReader(history_file))
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Relation-ablation result artifact "
                f"is unavailable: {exc.filename}"
            ),
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

    edges_by_graph = {
        "A1_target": (16380, 32760),
        "A2_enzyme": (5317, 10634),
        "A3_transporter": (3092, 6184),
        "A4_carrier": (864, 1728),
        "A5_indication": (9388, 18776),
        "A6_contraindication": (30675, 61350),
        "A7_off_label": (2568, 5136),
    }

    results = []
    for rank, row in enumerate(statistics["relations"], start=1):
        graph = row["graph"]
        if graph not in family_by_graph or graph not in edges_by_graph:
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected relation-ablation graph: {graph}.",
            )
        original_edges, directed_edges = edges_by_graph[graph]
        results.append({
            "rank": rank,
            "graph": graph,
            "relation": row["relation"],
            "family": family_by_graph[graph],
            "biomedical_edges": original_edges,
            "biomedical_directed_edges": directed_edges,
            "mrr_mean": row["mean_MRR"],
            "mrr_std": row["sd_MRR"],
            "delta_mrr_mean": row["mean_delta"],
            "delta_mrr_std": row["sd_delta"],
            "ci95_low": row["ci95_low"],
            "ci95_high": row["ci95_high"],
            "wins_vs_g0": row["wins"],
            "losses_vs_g0": row["losses"],
            "sign_flip_p": row["sign_flip_p"],
            "sign_flip_p_holm": row["sign_flip_p_holm"],
            "seed_deltas": [
                {
                    "seed": item["seed"],
                    "relation_mrr": item["MRR"],
                    "g0_mrr": item["G0_MRR"],
                    "delta_mrr": item["delta"],
                }
                for item in row["per_seed"]
            ],
        })

    history_rows.sort(
        key=lambda row: float(row["DeltaMRR_mean"]), reverse=True
    )
    history = [{
        "graph": row["graph"],
        "relation": row["Relation"],
        "mrr_mean": float(row["MRR_mean"]),
        "delta_mrr_mean": float(row["DeltaMRR_mean"]),
        "wins_vs_g0": int(row["PositiveSeeds"]),
    } for row in history_rows]

    return {
        "study_version": "relation-five-seed-v1",
        "study_type": "secondary follow-up analysis",
        "construction": (
            "Each variant retains the G0 DDI-only backbone and adds "
            "one biomedical relation together with its reverse edges."
        ),
        "seeds": [42, 43, 44, 45, 46],
        "relation_runs": 35,
        "paired_baseline_runs": 5,
        "baseline": {
            "graph": "G0",
            "mrr_mean": statistics["baseline"]["mean_MRR"],
            "mrr_std": statistics["baseline"]["sd_MRR"],
        },
        "results": results,
        "uncertainty": statistics["method"],
        "caveat": (
            "Uncertainty is across five training seeds on one fixed split. "
            "All pointwise 95% paired intervals include zero; the results "
            "are descriptive and do not establish improvement."
        ),
        "classification_note": (
            "This extension supplies ranking results only. Relation-level "
            "classification remains the historical three-seed evaluation "
            "for seeds 42, 43, and 44."
        ),
        "implementation_lineage": (
            "Seeds 45 and 46 use a validated explicit global incoming-edge "
            "mean. It implements the same mathematical operator as the "
            "historical route within tested tolerances; numerical agreement "
            "does not guarantee identical training trajectories."
        ),
        "history": {
            "label": "Historical three-seed ranking study",
            "seeds": [42, 43, 44],
            "baseline_mrr_mean": float(history_rows[0]["G0_MRR_mean"]),
            "results": history,
        },
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
        default="",
        max_length=200,
        description=(
            "Optional partial drug name or exact "
            "DrugBank identifier. Leave empty to browse."
        ),
    ),

    limit: int = Query(
        default=10,
        ge=1,
        le=50,
    ),

    offset: int = Query(
        default=0,
        ge=0,
    ),
):

    predictor = app.state.predictor
    normalized_query = q.strip()

    results, total_matching = predictor.search_drug_page(
        query=normalized_query,
        limit=limit,
        offset=offset,
    )

    return {
        "query":
            normalized_query,

        "count":
            len(results),

        "offset":
            offset,

        "limit":
            limit,

        "total_matching":
            total_matching,

        "has_more":
            offset + len(results) < total_matching,

        "results":
            results,
    }


@app.post("/api/drugs/match-text")
def match_drug_text(request: DrugTextMatchRequest):
    """Match OCR-extracted printed text without appearance-based inference."""
    predictor = app.state.predictor
    matches = predictor.match_drugs_in_text(
        text=request.text,
        limit=request.limit,
    )

    return {
        "text_received": request.text,
        "matches": matches,
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
# Single-drug G3 neighborhood
# ============================================================

def parse_csv_filter(value):
    if value is None:
        return None
    return [item.strip() for item in value.split(",") if item.strip()]


@app.get("/api/context/drug")
def drug_context(
    drug_id: str = Query(
        ...,
        min_length=1,
        max_length=100,
        description="Exact DrugBank ID for the center drug.",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    relations: str | None = Query(
        default=None,
        description="Comma-separated canonical relation names.",
    ),
    entity_types: str | None = Query(
        default=None,
        description="Comma-separated canonical entity types.",
    ),
):
    try:
        return app.state.neighborhood_store.get_drug_neighborhood(
            drug_id=drug_id,
            limit=limit,
            offset=offset,
            relations=parse_csv_filter(relations),
            entity_types=parse_csv_filter(entity_types),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=exc.args[0])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


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
