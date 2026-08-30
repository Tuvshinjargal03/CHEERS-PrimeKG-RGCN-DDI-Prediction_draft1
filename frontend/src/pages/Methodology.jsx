import { AlertCircle, Database, GitCompareArrows, Layers3, LoaderCircle, Target } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getJson } from '../lib/api.js'

export default function Methodology() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      getJson('/api/experiment'),
      getJson('/api/classification'),
      getJson('/api/model'),
    ])
      .then(([experiment, classification, model]) => {
        if (active) setData({ experiment, classification, model })
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Methodology metadata could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [])

  const summary = data?.experiment?.summary
  const classification = data?.classification?.summary
  const model = data?.model

  return (
    <section className="page">
      <div className="page-heading">
        <span className="eyebrow">Controlled research design</span>
        <h1>Methodology</h1>
        <p>
          A fixed-split comparison isolates how PrimeKG graph composition affects
          R-GCN drug–drug link prediction while keeping model and evaluation
          settings constant.
        </p>
      </div>

      {!data && !error && <div className="experiment-state"><LoaderCircle className="spin" size={26} />Loading methodology metadata…</div>}
      {error && <div className="experiment-state error"><AlertCircle size={26} />{error}</div>}

      {data && (
        <>
          <div className="methodology-flow">
            <article><Database size={23} /><span>1</span><h2>PrimeKG</h2><p>Canonical biomedical entities and relations, targeting <em>{model.target_relation.primekg_display_relation}</em>.</p></article>
            <article><GitCompareArrows size={23} /><span>2</span><h2>G0–G3</h2><p>Controlled DDI-only, molecular-context, disease-context, and combined graphs.</p></article>
            <article><Layers3 size={23} /><span>3</span><h2>{model.architecture}</h2><p>{model.embedding_dim}-dimensional embeddings with a {model.decoder}.</p></article>
            <article><Target size={23} /><span>4</span><h2>Evaluation</h2><p>Full filtered ranking plus complementary balanced binary discrimination.</p></article>
          </div>

          <div className="methodology-grid">
            <article className="method-card">
              <span className="card-kicker">Dataset and split</span><h2>One fixed DDI split</h2>
              <dl className="number-list"><div><dt>Training pairs</dt><dd>{summary.ddi_split.train.toLocaleString()}</dd></div><div><dt>Validation pairs</dt><dd>{summary.ddi_split.validation.toLocaleString()}</dd></div><div><dt>Test pairs</dt><dd>{summary.ddi_split.test.toLocaleString()}</dd></div><div><dt>Candidate drugs</dt><dd>{summary.candidate_drugs.toLocaleString()}</dd></div></dl>
              <p>Validation and test DDI edges are excluded from message passing. The same split is reused for every graph.</p>
            </article>

            <article className="method-card">
              <span className="card-kicker">Graph composition</span><h2>Four controlled variants</h2>
              <div className="composition-list">{Object.entries(summary.graph_variants).map(([graph, composition]) => <div key={graph}><strong>{graph}</strong><span>{composition}</span></div>)}</div>
              <p>G3 combines DDI, Drug–Gene/Protein, and Drug–Disease context while retaining the same target relation.</p>
            </article>

            <article className="method-card">
              <span className="card-kicker">Primary evaluation</span><h2>Full filtered ranking</h2>
              <p>Each held-out test pair is evaluated in both directions against all {summary.candidate_drugs.toLocaleString()} candidate drugs, producing {summary.evaluation.ranking_queries.toLocaleString()} ranking queries.</p>
              <div className="definition-list"><div><strong>MRR</strong><span>Rewards placing the true target near the top.</span></div><div><strong>Hits@1</strong><span>True target ranks first.</span></div><div><strong>Hits@5 / Hits@10</strong><span>True target appears in the top 5 or 10.</span></div></div>
            </article>

            <article className="method-card">
              <span className="card-kicker">Complementary evaluation</span><h2>Balanced binary classification</h2>
              <p>{classification.test_positive_pairs.toLocaleString()} held-out positives are paired with {classification.test_negative_pairs.toLocaleString()} fixed sampled-unobserved pairs.</p>
              <div className="definition-list"><div><strong>Threshold</strong><span>Chosen per graph and seed by maximizing validation F1, then frozen for test evaluation.</span></div><div><strong>Metrics</strong><span>Accuracy, Precision, Recall, and F1.</span></div></div>
            </article>
          </div>

          <div className="method-parameters section-block">
            <div className="section-title"><div><span className="eyebrow">Fixed model settings</span><h2>Architecture and training</h2></div></div>
            <div className="parameter-grid">
              {[['Architecture', summary.model.architecture], ['Embedding / hidden', `${summary.model.embedding_dim} / ${summary.model.hidden_dim}`], ['Dropout', summary.model.dropout], ['Learning rate', summary.model.learning_rate], ['Weight decay', summary.model.weight_decay], ['Maximum epochs', summary.model.max_epochs], ['Positives per epoch', summary.model.train_positives_per_epoch.toLocaleString()], ['Seeds', summary.random_seeds.join(', ')]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
          </div>

          <aside className="limitations-card"><AlertCircle size={21} /><div><strong>Interpretation boundaries</strong><ul><li>Sampled unobserved pairs are not confirmed non-interactions.</li><li>Raw model scores are ranking values, not probabilities or clinical risk estimates.</li><li>Five seeds provide robustness evidence; statistical significance is not claimed.</li><li>This research prototype does not establish whether a drug pair is safe, dangerous, beneficial, or harmful.</li></ul></div></aside>
        </>
      )}
    </section>
  )
}
