"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
    selectedDrug: null,
    suggestions: [],
    activeSuggestion: -1,
    lastPrediction: null,
    pairContext: null,
    contextFilter: "all",
    contextExpanded: false,
};

const GRAPH_VARIANTS = ["G0", "G1", "G2", "G3"];
const METRICS = ["MRR", "Hits@1", "Hits@5", "Hits@10"];
const CONTEXT_PAGE_SIZE = 10;

async function apiGet(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
}

async function apiPost(path, body) {
    const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.detail || `Request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

function switchSection(sectionName, updateHash = true) {
    $$(".page-section").forEach((section) => {
        const active = section.id === `section-${sectionName}`;
        section.hidden = !active;
        section.classList.toggle("active", active);
    });
    $$(".nav-button").forEach((button) => {
        const active = button.dataset.section === sectionName;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });
    if (updateHash) history.replaceState(null, "", `#${sectionName}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
}

$$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.section));
});

$("[data-nav-target]").addEventListener("click", (event) => {
    event.preventDefault();
    switchSection(event.currentTarget.dataset.navTarget);
});

async function checkHealth() {
    const dot = $("#apiStatusDot");
    const text = $("#apiStatusText");
    try {
        const health = await apiGet("/api/health");
        if (health.status === "ok" && health.model_loaded) {
            dot.className = "status-dot online";
            text.textContent = `${health.graph_variant} runtime ready`;
        } else throw new Error("Runtime unavailable");
    } catch (_) {
        dot.className = "status-dot offline";
        text.textContent = "Runtime unavailable";
    }
}

const drugInput = $("#drugSearch");
const suggestions = $("#searchSuggestions");
const predictButton = $("#predictButton");
let searchTimer;

function setSelectedDrug(drug) {
    state.selectedDrug = drug;
    drugInput.value = drug.name;
    predictButton.disabled = false;
    const status = $("#selectionStatus");
    status.textContent = `Selected: ${drug.name} (${drug.entity_id})`;
    status.classList.add("selected");
    hideSuggestions();
}

function clearSelection() {
    state.selectedDrug = null;
    predictButton.disabled = true;
    const status = $("#selectionStatus");
    status.textContent = "Select a search result to enable prediction.";
    status.classList.remove("selected");
}

function hideSuggestions() {
    suggestions.classList.add("hidden");
    suggestions.innerHTML = "";
    drugInput.setAttribute("aria-expanded", "false");
    state.suggestions = [];
    state.activeSuggestion = -1;
}

function updateActiveSuggestion() {
    $$(".suggestion-item").forEach((button, index) => {
        const active = index === state.activeSuggestion;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        if (active) button.scrollIntoView({ block: "nearest" });
    });
}

function renderSuggestions(items) {
    state.suggestions = items;
    state.activeSuggestion = -1;
    suggestions.innerHTML = "";
    suggestions.classList.remove("hidden");
    drugInput.setAttribute("aria-expanded", "true");

    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "suggestions-empty";
        empty.textContent = "No matching drugs found. Try another name or DrugBank ID.";
        suggestions.appendChild(empty);
        return;
    }

    items.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "suggestion-item";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        button.innerHTML = `<div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.entity_id)}</small></div><span>Select</span>`;
        button.addEventListener("mouseenter", () => {
            state.activeSuggestion = index;
            updateActiveSuggestion();
        });
        button.addEventListener("click", () => setSelectedDrug(item));
        suggestions.appendChild(button);
    });
}

async function searchDrugs(query) {
    try {
        const data = await apiGet(`/api/drugs/search?q=${encodeURIComponent(query)}&limit=8`);
        if (drugInput.value.trim() === query && !state.selectedDrug) renderSuggestions(data.results || []);
    } catch (_) {
        hideSuggestions();
    }
}

drugInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    clearSelection();
    const query = drugInput.value.trim();
    if (query.length < 2) {
        hideSuggestions();
        return;
    }
    searchTimer = window.setTimeout(() => searchDrugs(query), 180);
});

drugInput.addEventListener("keydown", (event) => {
    if (!state.suggestions.length) {
        if (event.key === "Escape") hideSuggestions();
        return;
    }
    if (event.key === "ArrowDown") {
        event.preventDefault();
        state.activeSuggestion = Math.min(state.activeSuggestion + 1, state.suggestions.length - 1);
        updateActiveSuggestion();
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        state.activeSuggestion = Math.max(state.activeSuggestion - 1, 0);
        updateActiveSuggestion();
    } else if (event.key === "Enter") {
        event.preventDefault();
        const index = state.activeSuggestion >= 0 ? state.activeSuggestion : 0;
        setSelectedDrug(state.suggestions[index]);
    } else if (event.key === "Escape") hideSuggestions();
});

document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-field")) hideSuggestions();
});

$$(".example-chip").forEach((button) => {
    button.addEventListener("click", async () => {
        const name = button.dataset.drug;
        drugInput.value = name;
        clearSelection();
        try {
            const data = await apiGet(`/api/drugs/search?q=${encodeURIComponent(name)}&limit=8`);
            const exact = (data.results || []).find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
            if (exact) setSelectedDrug(exact);
            else renderSuggestions(data.results || []);
        } catch (_) {
            showError("Drug search is temporarily unavailable. Please try again.");
        }
    });
});

function setPredictionState(name) {
    ["emptyPanel", "loadingPanel", "errorPanel", "noResultsPanel"].forEach((id) => {
        $(`#${id}`).classList.toggle("hidden", id !== name);
    });
}

function showError(message) {
    $("#errorPanel").textContent = message;
    setPredictionState("errorPanel");
}

predictButton.addEventListener("click", runPrediction);
drugInput.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && state.selectedDrug && state.suggestions.length === 0) runPrediction();
});

async function runPrediction() {
    if (!state.selectedDrug) {
        showError("Choose a drug from the search results before running prediction.");
        return;
    }
    predictButton.disabled = true;
    predictButton.textContent = "Analyzing...";
    $("#predictionResults").classList.add("hidden");
    setPredictionState("loadingPanel");

    try {
        const result = await apiPost("/api/predict", {
            drug: state.selectedDrug.entity_id,
            top_k: Number($("#topK").value),
        });
        if (!(result.predictions || []).length) {
            setPredictionState("noResultsPanel");
            return;
        }
        state.lastPrediction = result;
        renderPrediction(result);
        setPredictionState("none");
    } catch (error) {
        if (error.status === 404) showError("The selected drug could not be resolved. Search again and choose a listed result.");
        else showError("Prediction could not be completed. Confirm the local API is running and try again.");
    } finally {
        predictButton.disabled = !state.selectedDrug;
        predictButton.textContent = "Find predicted links";
    }
}

function renderPrediction(result) {
    const query = result.query;
    $("#resultTitle").textContent = `Predicted links for ${query.name}`;
    $("#summaryQuery").textContent = query.name;
    $("#summaryQueryId").textContent = query.entity_id;
    $("#summaryCandidates").textContent = formatNumber(result.candidate_drug_count);
    $("#summaryShown").textContent = formatNumber(result.predictions.length);
    $("#summaryModel").textContent = `R-GCN · ${result.model.graph}`;
    $("#summaryModelMeta").textContent = `Seed ${result.model.seed} · epoch ${result.model.best_epoch}`;
    $("#knownFiltered").textContent = formatNumber(result.known_positive_candidates_filtered);
    $("#availableCandidates").textContent = formatNumber(result.available_unobserved_candidates);
    resetPairContext();
    renderPredictionTable(result.predictions);
    $("#predictionResults").classList.remove("hidden");
    $("#predictionResults").scrollIntoView({ behavior: "smooth", block: "start" });
}

function scoreGeometry(scores, score) {
    const minimum = Math.min(0, ...scores);
    const maximum = Math.max(0, ...scores);
    const range = maximum - minimum || 1;
    const zero = ((0 - minimum) / range) * 100;
    const point = ((score - minimum) / range) * 100;
    return { zero, left: Math.min(zero, point), width: Math.abs(point - zero) };
}

function renderPredictionTable(predictions) {
    const tbody = $("#predictionTableBody");
    const scores = predictions.map((item) => Number(item.raw_score));
    tbody.innerHTML = "";
    predictions.forEach((item) => {
        const score = Number(item.raw_score);
        const geometry = scoreGeometry(scores, score);
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="rank-cell">#${item.rank}</td>
            <td><span class="drug-name">${escapeHtml(item.name)}</span></td>
            <td class="drug-id">${escapeHtml(item.entity_id)}</td>
            <td class="score-number">${score.toFixed(4)}</td>
            <td><div class="relative-score" aria-label="Relative position for model score ${score.toFixed(4)}"><i class="score-zero" style="left:${geometry.zero}%"></i><i class="score-fill ${score < 0 ? "negative" : ""}" style="left:${geometry.left}%;width:${geometry.width}%"></i></div></td>
            <td><button class="context-action" type="button">Explore context</button></td>`;
        row.querySelector(".context-action").addEventListener(
            "click",
            () => loadPairContext(item)
        );
        tbody.appendChild(row);
    });
}

function resetPairContext() {
    state.pairContext = null;
    state.contextFilter = "all";
    state.contextExpanded = false;
    $("#pairContextPanel").classList.add("hidden");
    $$(".context-action").forEach((button) => button.classList.remove("active"));
}

async function loadPairContext(candidate) {
    const query = state.lastPrediction && state.lastPrediction.query;
    if (!query) return;

    const panel = $("#pairContextPanel");
    panel.classList.remove("hidden");
    $("#pairContextTitle").textContent = `Graph context for ${query.name} + ${candidate.name}`;
    $("#contextLoading").classList.remove("hidden");
    $("#contextError").classList.add("hidden");
    $("#contextContent").classList.add("hidden");
    panel.setAttribute("aria-busy", "true");
    $$(".context-action").forEach((button) => button.classList.remove("active"));
    eventTargetButton(candidate.entity_id)?.classList.add("active");

    try {
        const path = (
            `/api/context/pair?drug_a_id=${encodeURIComponent(query.entity_id)}`
            + `&drug_b_id=${encodeURIComponent(candidate.entity_id)}`
        );
        const data = await apiGet(path);
        state.pairContext = data;
        state.contextFilter = "all";
        state.contextExpanded = false;
        renderPairContext(data);
        $("#contextContent").classList.remove("hidden");
    } catch (_) {
        $("#contextError").textContent = "Graph context could not be loaded for this pair.";
        $("#contextError").classList.remove("hidden");
    } finally {
        $("#contextLoading").classList.add("hidden");
        panel.removeAttribute("aria-busy");
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function eventTargetButton(entityId) {
    const rows = Array.from($("#predictionTableBody").querySelectorAll("tr"));
    const row = rows.find((item) => item.querySelector(".drug-id")?.textContent === entityId);
    return row ? row.querySelector(".context-action") : null;
}

function renderPairContext(data) {
    const drugA = data.drug_a;
    const drugB = data.drug_b;
    $("#contextDrugALabel").textContent = `${drugA.drug_name} context`;
    $("#contextDrugBLabel").textContent = `${drugB.drug_name} context`;
    $("#contextDrugACount").textContent = formatNumber(drugA.total_context_edges);
    $("#contextDrugBCount").textContent = formatNumber(drugB.total_context_edges);
    $("#contextSharedCount").textContent = formatNumber(data.shared.total);
    $("#contextGeneCount").textContent = formatNumber(data.shared.gene_protein_count);
    $("#contextDiseaseCount").textContent = formatNumber(data.shared.disease_count);
    $("#contextDrugAColumn").textContent = `${drugA.drug_name} relation`;
    $("#contextDrugBColumn").textContent = `${drugB.drug_name} relation`;
    $("#contextInterpretation").textContent = data.interpretation;
    $$(".context-filter").forEach((button) => {
        button.classList.toggle("active", button.dataset.contextGroup === "all");
    });
    renderSharedContext();
    renderIndividualContext(drugA, $("#individualDrugA"));
    renderIndividualContext(drugB, $("#individualDrugB"));
    $(".individual-context").open = false;
}

function renderSharedContext() {
    const data = state.pairContext;
    if (!data) return;
    const entities = data.shared.entities.filter(
        (entity) => state.contextFilter === "all"
            || entity.context_group === state.contextFilter
    );
    const displayed = state.contextExpanded
        ? entities
        : entities.slice(0, CONTEXT_PAGE_SIZE);
    const body = $("#sharedContextBody");
    body.innerHTML = "";

    displayed.forEach((entity) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><span class="context-entity-name">${escapeHtml(entity.context_name)}</span><span class="context-entity-id">${escapeHtml(entity.context_id)}</span></td>
            <td class="context-type">${entity.context_group === "gene/protein" ? "Gene / protein" : "Disease"}</td>
            <td>${renderRelationLabels(entity.drug_a_relations)}</td>
            <td>${renderRelationLabels(entity.drug_b_relations)}</td>
            <td>${escapeHtml(entity.context_source)}</td>`;
        body.appendChild(row);
    });

    const empty = entities.length === 0;
    $("#sharedContextEmpty").classList.toggle("hidden", !empty);
    $("#sharedContextTableWrap").classList.toggle("hidden", empty);
    const showAll = $("#showAllContextButton");
    showAll.classList.toggle("hidden", empty || entities.length <= CONTEXT_PAGE_SIZE);
    showAll.textContent = state.contextExpanded
        ? "Show first 10"
        : `Show all ${formatNumber(entities.length)}`;
}

function renderRelationLabels(relations) {
    return `<div class="relation-list">${relations.map(
        (relation) => `<span class="relation-label">${escapeHtml(formatRelation(relation))}</span>`
    ).join("")}</div>`;
}

function renderIndividualContext(drug, container) {
    container.innerHTML = `<h3>${escapeHtml(drug.drug_name)} <small>${escapeHtml(drug.drug_id)}</small></h3>`;
    [
        ["gene_protein", "Gene / protein relationships"],
        ["disease", "Disease relationships"],
    ].forEach(([groupKey, label]) => {
        const group = drug.context[groupKey];
        const heading = document.createElement("h4");
        heading.className = "individual-group-heading";
        heading.textContent = `${label} (${formatNumber(group.count)})`;
        container.appendChild(heading);
        if (!group.relationships.length) {
            const empty = document.createElement("p");
            empty.className = "individual-empty";
            empty.textContent = "No exported relationships in this group.";
            container.appendChild(empty);
            return;
        }
        const wrap = document.createElement("div");
        wrap.className = "individual-table-wrap";
        wrap.innerHTML = `
            <table class="individual-table">
                <thead><tr><th>Entity</th><th>Relation</th><th>Source</th></tr></thead>
                <tbody>${group.relationships.map((item) => `
                    <tr>
                        <td><span class="context-entity-name">${escapeHtml(item.context_name)}</span><span class="context-entity-id">${escapeHtml(item.context_id)}</span></td>
                        <td>${escapeHtml(formatRelation(item.relation))}</td>
                        <td>${escapeHtml(item.context_source)}</td>
                    </tr>`).join("")}</tbody>
            </table>`;
        container.appendChild(wrap);
    });
}

function formatRelation(relation) {
    const labels = {
        target: "Target",
        enzyme: "Enzyme",
        transporter: "Transporter",
        carrier: "Carrier",
        indication: "Indication",
        contraindication: "Contraindication",
        "off-label use": "Off-label use",
    };
    return labels[relation] || relation;
}

$$(".context-filter").forEach((button) => {
    button.addEventListener("click", () => {
        state.contextFilter = button.dataset.contextGroup;
        state.contextExpanded = false;
        $$(".context-filter").forEach((item) => item.classList.toggle("active", item === button));
        renderSharedContext();
    });
});

$("#showAllContextButton").addEventListener("click", () => {
    state.contextExpanded = !state.contextExpanded;
    renderSharedContext();
});

$("#closeContextButton").addEventListener("click", resetPairContext);

function svgNode(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(
        ([key, value]) => element.setAttribute(key, String(value))
    );
    return element;
}

function addSvgText(parent, text, attributes) {
    const element = svgNode("text", attributes);
    element.textContent = text;
    parent.appendChild(element);
    return element;
}

async function loadExperiment() {
    try {
        const data = await apiGet("/api/experiment");
        const summary = data.summary;
        renderMrrChart(summary.final_results_mean_std);
        renderPerformanceChart(summary.final_results_mean_std);
        $("#findingMrr").textContent = `${summary.primary_result.mean_MRR.toFixed(4)} ± ${summary.primary_result.MRR_std.toFixed(4)}`;
        $("#absoluteGain").textContent = `+${summary.primary_result.absolute_MRR_improvement_vs_G0.toFixed(6)}`;
        $("#relativeGain").textContent = `+${summary.primary_result.relative_MRR_improvement_percent.toFixed(2)}%`;
        renderExperimentScale(summary);
    } catch (_) {
        $("#mrrChart").textContent = "Experiment results could not be loaded.";
        $("#performanceChart").textContent = "Performance results could not be loaded.";
    }
}

function chartText(svg, text, x, y, className, anchor = "middle") {
    return addSvgText(svg, text, { x, y, class: className, "text-anchor": anchor });
}

function renderMrrChart(results) {
    const width = 720;
    const height = 350;
    const margin = { top: 30, right: 25, bottom: 48, left: 52 };
    const plotHeight = height - margin.top - margin.bottom;
    const plotWidth = width - margin.left - margin.right;
    const max = 0.6;
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Mean MRR bar chart for graph variants G0 through G3, with an axis from zero to 0.6" });
    const title = svgNode("title");
    title.textContent = "Mean MRR across G0, G1, G2, and G3";
    svg.appendChild(title);

    for (let tick = 0; tick <= 6; tick += 1) {
        const value = tick / 10;
        const y = margin.top + plotHeight - (value / max) * plotHeight;
        svg.appendChild(svgNode("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: tick ? "chart-grid" : "chart-axis" }));
        chartText(svg, value.toFixed(1), margin.left - 10, y + 3, "chart-axis-label", "end");
    }
    chartText(svg, "Mean MRR", 13, height / 2, "chart-axis-label").setAttribute("transform", `rotate(-90 13 ${height / 2})`);

    const slot = plotWidth / GRAPH_VARIANTS.length;
    const barWidth = 78;
    GRAPH_VARIANTS.forEach((graph, index) => {
        const { mean, std } = results[graph].MRR;
        const x = margin.left + index * slot + (slot - barWidth) / 2;
        const y = margin.top + plotHeight - (mean / max) * plotHeight;
        const barHeight = (mean / max) * plotHeight;
        const bar = svgNode("rect", { x, y, width: barWidth, height: barHeight, rx: 4, class: `mrr-bar ${graph === "G3" ? "best" : ""}` });
        const tip = svgNode("title");
        tip.textContent = `${graph}: MRR ${mean.toFixed(6)} ± ${std.toFixed(6)}`;
        bar.appendChild(tip);
        svg.appendChild(bar);
        const errorTop = margin.top + plotHeight - ((mean + std) / max) * plotHeight;
        const errorBottom = margin.top + plotHeight - ((mean - std) / max) * plotHeight;
        const mid = x + barWidth / 2;
        svg.appendChild(svgNode("line", { x1: mid, y1: errorTop, x2: mid, y2: errorBottom, class: "error-line" }));
        svg.appendChild(svgNode("line", { x1: mid - 7, y1: errorTop, x2: mid + 7, y2: errorTop, class: "error-line" }));
        svg.appendChild(svgNode("line", { x1: mid - 7, y1: errorBottom, x2: mid + 7, y2: errorBottom, class: "error-line" }));
        chartText(svg, mean.toFixed(6), mid, y - 18, "chart-value-label");
        chartText(svg, `± ${std.toFixed(6)}`, mid, y - 6, "chart-axis-label");
        chartText(svg, graph, mid, height - 22, "chart-value-label");
    });
    const container = $("#mrrChart");
    container.innerHTML = "";
    container.appendChild(svg);
}

function renderPerformanceChart(results) {
    const width = 940;
    const height = 420;
    const margin = { top: 50, right: 20, bottom: 62, left: 55 };
    const plotHeight = height - margin.top - margin.bottom;
    const plotWidth = width - margin.left - margin.right;
    const max = 0.7;
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Grouped bar chart comparing MRR, Hits at 1, Hits at 5, and Hits at 10 for G0 through G3" });

    GRAPH_VARIANTS.forEach((graph, index) => {
        const x = margin.left + index * 92;
        svg.appendChild(svgNode("rect", { x, y: 12, width: 11, height: 11, class: `metric-bar ${graph.toLowerCase()}` }));
        chartText(svg, graph, x + 17, 21, "chart-axis-label", "start");
    });
    for (let tick = 0; tick <= 7; tick += 1) {
        const value = tick / 10;
        const y = margin.top + plotHeight - (value / max) * plotHeight;
        svg.appendChild(svgNode("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: tick ? "chart-grid" : "chart-axis" }));
        chartText(svg, value.toFixed(1), margin.left - 10, y + 3, "chart-axis-label", "end");
    }
    const groupWidth = plotWidth / METRICS.length;
    const barWidth = 34;
    METRICS.forEach((metric, metricIndex) => {
        const groupX = margin.left + metricIndex * groupWidth + (groupWidth - barWidth * 4) / 2;
        GRAPH_VARIANTS.forEach((graph, graphIndex) => {
            const value = results[graph][metric].mean;
            const x = groupX + graphIndex * barWidth;
            const y = margin.top + plotHeight - (value / max) * plotHeight;
            const bar = svgNode("rect", { x: x + 2, y, width: barWidth - 4, height: (value / max) * plotHeight, rx: 2, class: `metric-bar ${graph.toLowerCase()}` });
            const tip = svgNode("title");
            tip.textContent = `${graph} ${metric}: ${value.toFixed(6)}`;
            bar.appendChild(tip);
            svg.appendChild(bar);
            const label = chartText(svg, value.toFixed(6), x + barWidth / 2 + 3, y - 5, "chart-axis-label", "start");
            label.setAttribute("transform", `rotate(-65 ${x + barWidth / 2 + 3} ${y - 5})`);
        });
        chartText(svg, metric, margin.left + metricIndex * groupWidth + groupWidth / 2, height - 24, "chart-value-label");
    });
    const container = $("#performanceChart");
    container.innerHTML = "";
    container.appendChild(svg);
}

function renderExperimentScale(summary) {
    const values = [
        ["Training DDI pairs", summary.ddi_split.train],
        ["Validation DDI pairs", summary.ddi_split.validation],
        ["Test DDI pairs", summary.ddi_split.test],
        ["Candidate drugs", summary.candidate_drugs],
        ["Test ranking queries", summary.evaluation.ranking_queries],
        ["Seeds", summary.random_seeds.join(", ")],
    ];
    $("#experimentScale").innerHTML = values.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${typeof value === "number" ? formatNumber(value) : escapeHtml(value)}</strong></article>`).join("");
}

async function loadVerification() {
    const list = $("#verificationList");
    try {
        const data = await apiGet("/api/verification");
        $("#verificationCount").textContent = data.overall_status.replace(" verification checks passed", "").replace("/", " / ");
        $("#verificationInterpretation").textContent = data.interpretation;
        list.innerHTML = "";
        (data.checks || []).forEach((item) => {
            const article = document.createElement("article");
            article.className = "verification-item";
            article.innerHTML = `<span class="check-number">${escapeHtml(item.check)}</span><div><h2>${escapeHtml(item.verification)}</h2><p>${escapeHtml(item.what_was_checked)}</p><small>${escapeHtml(item.key_result)}</small></div><span class="pass-badge">${escapeHtml(item.status)}</span>`;
            list.appendChild(article);
        });
    } catch (_) {
        list.innerHTML = '<div class="error-panel">The verification record could not be loaded.</div>';
    }
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value);
    return element.innerHTML;
}

function formatNumber(value) {
    return Number(value).toLocaleString("en-US");
}

function truncate(value, length) {
    const text = String(value);
    return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

async function initialize() {
    const requestedSection = window.location.hash.slice(1);
    if (["predict", "experiment", "verification", "about"].includes(requestedSection)) {
        switchSection(requestedSection, false);
    }
    await Promise.allSettled([checkHealth(), loadExperiment(), loadVerification()]);
}

initialize();
