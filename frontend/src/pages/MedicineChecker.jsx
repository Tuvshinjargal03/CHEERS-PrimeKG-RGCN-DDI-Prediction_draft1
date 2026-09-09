import {
  AlertCircle,
  ArrowRight,
  Beaker,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Info,
  LoaderCircle,
  Network,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import MedicineLabelScanner from '../components/MedicineLabelScanner.jsx'
import { G3_CONTEXT_CANDIDATE_IDS } from '../data/g3ContextCandidateIds.js'
import { getJson, pairEndpoint, resolveDrug } from '../lib/api.js'
import { derivePairReviewStatus } from '../lib/pairStatus.js'
import './PublicProduct.css'

const CONTEXT_IDS = new Set(G3_CONTEXT_CANDIDATE_IDS)
const SECTION_LABELS = {
  drug_interactions: 'Drug interactions',
  contraindications: 'Contraindications',
  boxed_warning: 'Boxed warning',
  warnings: 'Warnings',
  warnings_and_cautions: 'Warnings and cautions',
  precautions: 'Precautions',
}

function validSourceUrl(value, expectedHost) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (!expectedHost || url.hostname === expectedHost) ? url.href : null
  } catch {
    return null
  }
}

function hasContext(drug) {
  return Boolean(drug?.entity_id && CONTEXT_IDS.has(drug.entity_id.toUpperCase()))
}

export default function MedicineChecker() {
  const [searchParams] = useSearchParams()
  const initialAId = searchParams.get('drug_a_id') || ''
  const initialBId = searchParams.get('drug_b_id') || ''
  const [drugA, setDrugA] = useState(null)
  const [drugB, setDrugB] = useState(null)
  const [resolving, setResolving] = useState(Boolean(initialAId || initialBId))
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [evidence, setEvidence] = useState(null)
  const [context, setContext] = useState(null)
  const [evidenceError, setEvidenceError] = useState('')
  const [contextError, setContextError] = useState('')
  const [expandedLabels, setExpandedLabels] = useState({})
  const [showAllPapers, setShowAllPapers] = useState(false)

  useEffect(() => {
    if (!initialAId && !initialBId) return undefined
    let active = true
    Promise.all([resolveDrug(initialAId), resolveDrug(initialBId)])
      .then(([resolvedA, resolvedB]) => {
        if (!active) return
        setDrugA(resolvedA)
        setDrugB(resolvedB)
        if ((initialAId && !resolvedA) || (initialBId && !resolvedB)) {
          setEvidenceError('One of the requested medicine identifiers could not be found.')
        }
      })
      .catch((error) => {
        if (active) setEvidenceError(error.message || 'The requested medicines could not be loaded.')
      })
      .finally(() => {
        if (active) setResolving(false)
      })
    return () => {
      active = false
    }
  }, [initialAId, initialBId])

  const pairReady = Boolean(drugA && drugB && drugA.entity_id !== drugB.entity_id)
  const contextAvailable = hasContext(drugA) && hasContext(drugB)
  const status = useMemo(
    () => derivePairReviewStatus(evidence, Boolean(evidenceError)),
    [evidence, evidenceError],
  )
  const labelItems = evidence?.label_evidence?.pair_evidence || []
  const papers = evidence?.literature?.papers || []
  const params = pairReady
    ? new URLSearchParams({ drug_a_id: drugA.entity_id, drug_b_id: drugB.entity_id }).toString()
    : ''

  function resetResults() {
    setSubmitted(false)
    setEvidence(null)
    setContext(null)
    setEvidenceError('')
    setContextError('')
    setExpandedLabels({})
    setShowAllPapers(false)
  }

  function selectA(drug) {
    setDrugA(drug)
    resetResults()
  }

  function selectB(drug) {
    setDrugB(drug)
    resetResults()
  }

  async function checkPair(event) {
    event.preventDefault()
    if (!pairReady) return

    setLoading(true)
    setSubmitted(true)
    setEvidence(null)
    setContext(null)
    setEvidenceError('')
    setContextError('')

    const requests = [
      getJson(pairEndpoint('/api/evidence/pair', drugA.entity_id, drugB.entity_id)),
      contextAvailable
        ? getJson(pairEndpoint('/api/context/pair', drugA.entity_id, drugB.entity_id))
        : Promise.resolve(null),
    ]
    const [evidenceResult, contextResult] = await Promise.allSettled(requests)

    if (evidenceResult.status === 'fulfilled') {
      setEvidence(evidenceResult.value)
    } else {
      setEvidenceError(evidenceResult.reason?.message || 'The checked sources could not be retrieved.')
    }

    if (contextResult.status === 'fulfilled') {
      setContext(contextResult.value)
    } else {
      setContextError(contextResult.reason?.message || 'Related biomedical information could not be loaded.')
    }
    setLoading(false)
  }

  return (
    <section className="page product-page medicine-checker-page">
      <header className="product-page-header">
        <span className="eyebrow">Check medicines</span>
        <h1>Review two medicines together</h1>
        <p>
          Choose two medicines to review drug-label information, related research,
          and available biomedical connections. CHEERS does not make a personal treatment decision.
        </p>
      </header>

      <form className="product-input-panel checker-form" onSubmit={checkPair}>
        <div className="checker-form-heading">
          <div>
            <span className="eyebrow">Medicine pair</span>
            <h2>Which medicines would you like to check?</h2>
          </div>
          <span className="product-step-badge">2 medicines</span>
        </div>

        <div className="checker-fields">
          <div className="product-drug-field">
            <DrugAutocomplete label="First medicine" selection={drugA} onSelect={selectA} disabled={loading || resolving} />
            <MedicineLabelScanner targetLabel="First medicine" onDrugSelect={selectA} disabled={loading || resolving} />
          </div>
          <div className="checker-plus" aria-hidden="true">+</div>
          <div className="product-drug-field">
            <DrugAutocomplete label="Second medicine" selection={drugB} onSelect={selectB} disabled={loading || resolving} />
            <MedicineLabelScanner targetLabel="Second medicine" onDrugSelect={selectB} disabled={loading || resolving} />
          </div>
        </div>

        {drugA && drugB && drugA.entity_id === drugB.entity_id && (
          <p className="product-field-note"><Info size={15} /> Choose two different medicines.</p>
        )}

        <button className="primary-button checker-submit" type="submit" disabled={!pairReady || loading || resolving}>
          {loading || resolving ? <LoaderCircle className="spin" size={18} /> : <ShieldAlert size={18} />}
          {loading ? 'Checking available sources…' : 'Check available information'}
        </button>
      </form>

      {!submitted && !loading && (
        <div className="product-empty-state">
          <Beaker size={25} />
          <div><strong>Start with two medicines</strong><p>Results keep official sources, biomedical connections, and advanced research output separate.</p></div>
        </div>
      )}

      {loading && (
        <div className="product-empty-state" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={25} />
          <div><strong>Checking available sources…</strong><p>This may take a moment while external information is retrieved.</p></div>
        </div>
      )}

      {submitted && !loading && (
        <div className="checker-results" aria-live="polite">
          <article className={`pair-status-card is-${status.key}`}>
            <div className="pair-status-icon">
              {status.key === 'important' ? <ShieldAlert size={24} /> : status.key === 'review' ? <Info size={24} /> : <AlertCircle size={24} />}
            </div>
            <div>
              <span>Checked-source status</span>
              <div className="checker-result-pair" aria-label="Checked medicine pair">
                <strong>{drugA?.name}</strong>
                <b aria-hidden="true">+</b>
                <strong>{drugB?.name}</strong>
              </div>
              <h2>{status.title}</h2>
              <p>{status.description}</p>
              <small>This does not guarantee that the combination is safe for a specific person.</small>
            </div>
          </article>

          <section className="checker-summary-grid" aria-label="Checked information summary">
            <article>
              <FileSearch size={18} aria-hidden="true" />
              <div><strong>{labelItems.length}</strong><span>FDA label {labelItems.length === 1 ? 'mention' : 'mentions'}</span></div>
            </article>
            <article>
              <BookOpen size={18} aria-hidden="true" />
              <div><strong>{papers.length}</strong><span>Related PubMed {papers.length === 1 ? 'article' : 'articles'}</span></div>
            </article>
            <article>
              <Network size={18} aria-hidden="true" />
              <div><strong>{context ? context.shared?.total || 0 : '—'}</strong><span>Shared biomedical connections</span></div>
            </article>
          </section>

          {evidenceError && (
            <div className="product-source-error" role="alert">
              <AlertCircle size={20} /><span>{evidenceError}</span>
            </div>
          )}

          <section className="product-result-section" aria-labelledby="checked-sources-heading">
            <div className="product-section-title">
              <div><span className="eyebrow">Source details</span><h2 id="checked-sources-heading">What the checked sources returned</h2></div>
              {params && <Link className="text-action" to={`/evidence?${params}`}>Open full source view <ArrowRight size={15} /></Link>}
            </div>

            <div className="checker-source-grid">
              <article className="product-source-card">
                <div className="product-source-card-title"><FileSearch size={19} /><div><span>Official source</span><h3>Official drug-label information</h3></div></div>
                {labelItems.length ? (
                  <div className="checker-evidence-list">
                    {labelItems.slice(0, 3).map((item, index) => (
                      <article className="checker-label-item" key={`${item.section}-${index}`}>
                        <div className="checker-label-meta">
                          <strong>{item.source_drug}</strong>
                          <span>{SECTION_LABELS[item.section] || item.section}</span>
                        </div>
                        <p className={expandedLabels[index] ? '' : 'is-clamped'}>{item.snippet}</p>
                        <button
                          type="button"
                          className="product-inline-button"
                          aria-expanded={Boolean(expandedLabels[index])}
                          onClick={() => setExpandedLabels((current) => ({ ...current, [index]: !current[index] }))}
                        >
                          {expandedLabels[index] ? 'Show less' : 'View label details'}
                        </button>
                      </article>
                    ))}
                    <p className="product-count-note">{labelItems.length} source-backed label {labelItems.length === 1 ? 'mention' : 'mentions'} retrieved.</p>
                  </div>
                ) : (
                  <div className="product-card-empty"><strong>No explicit cross-medicine label mention retrieved.</strong><p>This is not proof that no interaction exists.</p></div>
                )}
                {validSourceUrl(evidence?.label_evidence?.source_url, 'api.fda.gov') && (
                  <a className="product-source-link" href={evidence.label_evidence.source_url} target="_blank" rel="noopener noreferrer">openFDA source <ExternalLink size={14} /></a>
                )}
              </article>

              <article className="product-source-card">
                <div className="product-source-card-title"><BookOpen size={19} /><div><span>Published literature</span><h3>Related research articles</h3></div></div>
                {papers.length ? (
                  <div className="checker-paper-list">
                    {papers.slice(0, showAllPapers ? papers.length : 3).map((paper) => (
                      <article key={paper.pmid}>
                        <h4>{paper.title || `PMID ${paper.pmid}`}</h4>
                        <p>{[paper.journal, paper.publication_date].filter(Boolean).join(' · ')}</p>
                        {validSourceUrl(paper.url, 'pubmed.ncbi.nlm.nih.gov') && <a href={paper.url} target="_blank" rel="noopener noreferrer">PMID {paper.pmid} <ExternalLink size={13} /></a>}
                      </article>
                    ))}
                    <p className="product-count-note">{papers.length} related {papers.length === 1 ? 'record' : 'records'} retrieved.</p>
                    {papers.length > 3 && (
                      <button type="button" className="product-inline-button" onClick={() => setShowAllPapers((current) => !current)}>
                        {showAllPapers ? 'Show fewer' : `View all ${papers.length}`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="product-card-empty"><strong>No related PubMed record retrieved.</strong><p>This is not a systematic literature review.</p></div>
                )}
              </article>
            </div>
          </section>

          <section className="product-result-section" aria-labelledby="context-heading">
            <div className="product-section-title">
              <div><span className="eyebrow">Related information</span><h2 id="context-heading">Shared biomedical connections</h2></div>
            </div>
            <article className="product-context-card">
              <span className="public-quick-icon"><Network size={21} /></span>
              <div>
                {context ? (
                  <><h3>{context.shared?.total || 0} shared connections found</h3><p>CHEERS found {context.shared?.disease_count || 0} disease and {context.shared?.gene_protein_count || 0} gene/protein connections in the knowledge graph.</p></>
                ) : (
                  <><h3>{contextAvailable ? 'Shared context could not be displayed' : 'Verified pair context is not available'}</h3><p>{contextError || 'One or both medicines do not have exported G3 support context. This does not mean no biomedical relationship exists.'}</p></>
                )}
              </div>
              {context && params && <Link className="secondary-button" to={`/graph?${params}`}>Explore graph <Network size={16} /></Link>}
            </article>
          </section>

          <aside className="research-output-gateway">
            <span><Search size={20} /></span>
            <div><small>Advanced research</small><strong>R-GCN Predictor</strong><p>The Predictor ranks candidate graph links. Its raw score is not a probability or clinical safety score.</p></div>
            <Link to="/predictor">Open research Predictor <ArrowRight size={15} /></Link>
          </aside>
        </div>
      )}

      <p className="product-page-boundary">
        <CheckCircle2 size={15} /> Information from checked sources supports review, not personalized medical advice.
      </p>
    </section>
  )
}
