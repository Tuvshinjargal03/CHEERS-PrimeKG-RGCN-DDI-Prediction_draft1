import { AlertCircle, ArrowRight, LoaderCircle, Network, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
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
    <section className="page">
      <div className="page-heading">
        <span className="eyebrow">Verified G3 inference</span>
        <h1>DDI Predictor</h1>
        <p>
          Rank candidate PrimeKG <em>synergistic interaction</em> links that are
          unobserved in the known positive set. Scores are model-ranking values,
          not probabilities, confidence, risk, or clinical certainty.
        </p>
      </div>

      <form className="predictor-form" onSubmit={submit}>
        <DrugAutocomplete label="Query drug" selection={drug} onSelect={(value) => { setDrug(value); setResult(null); setError('') }} />
        <label className="select-field">
          <span>Number of candidates</span>
          <select value={topK} onChange={(event) => setTopK(event.target.value)}>
            {[5, 10, 15, 20].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={!drug || loading}>
          {loading ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
          {loading ? 'Ranking candidates…' : 'Find predicted links'}
        </button>
      </form>

      {error && <div className="inline-alert error"><AlertCircle size={20} />{error}</div>}

      {!result && !loading && !error && (
        <div className="empty-feature-state">
          <Search size={28} />
          <div><strong>Select a query drug to begin.</strong><p>The verified G3 seed-44 model will return the highest-ranked unobserved candidates.</p></div>
        </div>
      )}

      {result && (
        <>
          <div className="prediction-summary">
            <div><span>Query</span><strong>{result.query.name}</strong><small>{result.query.entity_id}</small></div>
            <div><span>Model</span><strong>{result.model.graph} R-GCN</strong><small>Seed {result.model.seed} · epoch {result.model.best_epoch}</small></div>
            <div><span>Candidate space</span><strong>{result.candidate_drug_count.toLocaleString()}</strong><small>{result.known_positive_candidates_filtered.toLocaleString()} known links filtered</small></div>
            <div><span>Returned</span><strong>{result.predictions.length}</strong><small>unobserved candidate links</small></div>
          </div>

          <div className="section-block">
            <div className="section-title"><div><span className="eyebrow">Prediction results</span><h2>Ranked candidate links</h2></div></div>
            {result.predictions.length ? (
              <div className="prediction-list">
                {result.predictions.map((candidate) => (
                  <article key={candidate.entity_id} className="prediction-row">
                    <span className="rank-badge">#{candidate.rank}</span>
                    <div className="prediction-drug"><strong>{candidate.name}</strong><small>{candidate.entity_id}</small></div>
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
            <div><strong>Research prototype only</strong><p>{result.disclaimer} The target relation is PrimeKG “synergistic interaction”; this output is not a clinical decision tool.</p></div>
          </aside>
        </>
      )}
    </section>
  )
}
