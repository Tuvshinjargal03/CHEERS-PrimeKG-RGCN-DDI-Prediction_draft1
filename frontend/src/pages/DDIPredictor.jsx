import { AlertCircle, ArrowRight, LoaderCircle, Network, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import MedicineLabelScanner from '../components/MedicineLabelScanner.jsx'
import { postJson } from '../lib/api.js'

function destination(path, query, candidate, score) {
  const params = new URLSearchParams({
    drug_a_id: query.entity_id,
    drug_b_id: candidate.entity_id,
    score: String(score),
  })
  return `${path}?${params.toString()}`
}

export default function DDIPredictor() {
  const navigate = useNavigate()
  const [drug, setDrug] = useState(null)
  const [topK, setTopK] = useState(10)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function selectDrug(value) {
    setDrug(value)
    setResult(null)
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (!drug) {
      setError('Choose a drug from the search results first.')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const payload = await postJson('/api/predict', {
        drug: drug.entity_id,
        top_k: Number(topK),
      })
      setResult(payload)
    } catch (requestError) {
      setError(requestError.message || 'Prediction could not be completed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page predictor-page">
      <div className="page-heading">
        <span className="eyebrow">Verified exported G3 runtime</span>
        <h1>DDI Predictor</h1>
        <p>Use the deployed G3 seed-44 research model to rank eligible, unobserved PrimeKG <em>synergistic interaction</em> candidate links.</p>
      </div>

      <form className="predictor-form" onSubmit={submit}>
        <div className="predictor-form-heading">
          <span className="eyebrow">Prediction setup</span>
          <h2>Choose a medicine and ranking size</h2>
          <p>Search is the primary input. Label scanning is an optional text-selection helper.</p>
        </div>
        <div className="drug-selection-field">
          <span className="predictor-step-label">1. Choose query medicine</span>
          <DrugAutocomplete label="Medicine name or DrugBank ID" selection={drug} onSelect={selectDrug} />
          <div className="predictor-scanner-helper">
            <span>Optional label-text helper</span>
            <MedicineLabelScanner targetLabel="Query medicine" onDrugSelect={selectDrug} />
            <small>Reads printed label text to help select a supported medicine; it does not identify a medicine clinically.</small>
          </div>
        </div>
        <label className="select-field">
          <span>2. Ranked candidates to return</span>
          <select value={topK} onChange={(event) => setTopK(event.target.value)}>
            {[5, 10, 15, 20].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <small className="predictor-field-help">Choose how many candidates to show from the eligible set.</small>
        </label>
        <button type="submit" className="primary-button predictor-submit-button" disabled={!drug || loading}>
          {loading ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
          {loading ? 'Ranking candidates…' : 'Run R-GCN ranking'}
        </button>
      </form>

      {error && <div className="inline-alert error predictor-state" role="alert"><AlertCircle size={20} />{error}</div>}
      {loading && (
        <div className="empty-feature-state predictor-state" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={28} />
          <div><strong>Ranking candidate links…</strong><p>The verified G3 model is evaluating eligible unobserved candidates.</p></div>
        </div>
      )}
      {!result && !loading && !error && (
        <div className="empty-feature-state predictor-state">
          <Search size={28} />
          <div>
            <strong>Select a query medicine to begin.</strong>
            <p>The model ranks eligible candidate links after filtering known positive links. Returned candidates are unobserved in that known positive set, not confirmed non-interactions. This output is for research only.</p>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="predictor-result-heading">
            <span className="eyebrow">Model output</span>
            <h2>Prediction overview</h2>
          </div>
          <div className="prediction-summary">
            <div className="prediction-summary-primary"><span>Query</span><strong>{result.query.name}</strong><small>{result.query.entity_id}</small></div>
            <div><span>Model / runtime</span><strong>{result.model.graph} R-GCN</strong><small>Seed {result.model.seed}{result.model.best_epoch != null ? ` · epoch ${result.model.best_epoch}` : ''}</small></div>
            <div><span>Candidate space</span><strong>{result.candidate_drug_count.toLocaleString()} drugs</strong><small>{result.known_positive_candidates_filtered.toLocaleString()} known positive candidates filtered{result.available_unobserved_candidates != null ? ` · ${result.available_unobserved_candidates.toLocaleString()} eligible unobserved` : ''}</small></div>
            <div><span>Returned candidates</span><strong>{result.predictions.length}</strong><small>ranked unobserved candidate links</small></div>
          </div>

          <div className="section-block predictor-results-block">
            <div className="section-title predictor-results-heading">
              <div><span className="eyebrow">Model ranking</span><h2>Ranked candidate links</h2></div>
              <p>Scores are only comparable for ranking candidates produced by this model query; they are not calibrated clinical probabilities.</p>
            </div>
            <div className="predictor-follow-up-note" aria-label="How to interpret follow-up views">
              <p><strong>Graph context</strong> shows graph relationships. It does not validate the prediction or prove causation or interaction.</p>
              <p><strong>Review evidence</strong> retrieves independent FDA/PubMed information. It does not validate, modify, or calibrate the R-GCN score.</p>
            </div>
            {result.predictions.length ? (
              <div className="prediction-list">
                {result.predictions.map((candidate) => (
                  <article key={candidate.entity_id} className="prediction-row">
                    <span className="rank-badge">#{candidate.rank}</span>
                    <div className="prediction-drug"><strong>{candidate.name}</strong><small>DrugBank · {candidate.entity_id}</small></div>
                    <div className="score-block"><span>Raw model score</span><strong>{Number(candidate.raw_score).toFixed(4)}</strong></div>
                    <div className="prediction-actions">
                      <button type="button" className="secondary-button" onClick={() => navigate(destination('/graph', result.query, candidate, candidate.raw_score))}><Network size={16} />Graph context</button>
                      <button type="button" className="text-action" onClick={() => navigate(destination('/evidence', result.query, candidate, candidate.raw_score))}>Review evidence<ArrowRight size={15} /></button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="inline-alert">No available candidate links were returned.</div>}
          </div>

          <aside className="safety-notice">
            <AlertCircle size={21} />
            <div>
              <strong>Research prototype: ranking output only</strong>
              <p>{result.disclaimer}</p>
              <p>The target relation is PrimeKG “synergistic interaction”. This output is not clinical decision support or diagnosis/treatment advice. A high score does not establish interaction severity or safety, and a missing or low-ranked candidate is not proof of no interaction.</p>
            </div>
          </aside>
        </>
      )}
    </section>
  )
}
