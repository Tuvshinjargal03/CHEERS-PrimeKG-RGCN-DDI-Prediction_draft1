import { AlertCircle, BookOpen, ExternalLink, FileSearch, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import MedicineLabelScanner from '../components/MedicineLabelScanner.jsx'
import { getJson, pairEndpoint, resolveDrug } from '../lib/api.js'

const SECTION_NAMES = {
  drug_interactions: 'Drug interactions',
  contraindications: 'Contraindications',
  boxed_warning: 'Boxed warning',
  warnings: 'Warnings',
  warnings_and_cautions: 'Warnings and cautions',
  precautions: 'Precautions',
}

const INITIAL_LABEL_EXCERPTS = 8
const SECTION_ORDER = Object.keys(SECTION_NAMES)

function readableSectionNames(evidenceItems) {
  return [...new Set(evidenceItems.map((item) => item.section).filter(Boolean))]
    .sort((left, right) => {
      const leftIndex = SECTION_ORDER.indexOf(left)
      const rightIndex = SECTION_ORDER.indexOf(right)
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right)
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    })
    .map((section) => SECTION_NAMES[section] || section)
}

function labelAvailabilitySummary(labelEvidence) {
  const statuses = [labelEvidence?.drug_a?.status, labelEvidence?.drug_b?.status]
  const availableCount = statuses.filter((status) => status === 'ok').length
  const noMatchCount = statuses.filter((status) => status === 'no_matches').length
  const errorCount = statuses.filter((status) => status === 'error').length

  if (availableCount === 2) return 'openFDA returned label records for both medicines.'
  if (availableCount === 1 && noMatchCount === 1) {
    return 'Label information was retrieved for one medicine; the other source returned no matching label records.'
  }
  if (availableCount === 1 && errorCount === 1) {
    return 'Label information was retrieved for one medicine; retrieval for the other medicine was unavailable.'
  }
  if (noMatchCount === 2) return 'openFDA returned no matching label records for either medicine.'
  if (errorCount === 2) return 'openFDA label retrieval was unavailable for both medicines.'
  if (noMatchCount === 1 && errorCount === 1) {
    return 'One medicine returned no matching label records; retrieval for the other medicine was unavailable.'
  }
  return 'openFDA label retrieval status was unavailable for one or both medicines.'
}

function labelStatusSummary(label, fallbackName) {
  const name = label?.drug_name || fallbackName
  if (label?.status === 'ok') {
    const examined = Number.isFinite(Number(label.records_examined))
      ? ` ${Number(label.records_examined).toLocaleString()} label record(s) examined.`
      : ''
    return `${name}: label records retrieved.${examined}`
  }
  if (label?.status === 'no_matches') return `${name}: no matching label records.`
  if (label?.status === 'error') return `${name}: label retrieval unavailable.`
  return `${name}: label retrieval status unavailable.`
}

function pairMentionSummary(evidenceItems) {
  if (!evidenceItems.length) {
    return 'No explicit cross-medicine name mention was retrieved from the checked label sections.'
  }

  const sections = readableSectionNames(evidenceItems)
  const noun = evidenceItems.length === 1 ? 'excerpt was' : 'excerpts were'
  const sectionSummary = sections.length ? ` Sections: ${sections.join(', ')}.` : ''
  return `${evidenceItems.length.toLocaleString()} explicit cross-medicine name-mention ${noun} retrieved.${sectionSummary}`
}

function pubMedSummary(literature) {
  if (literature?.status === 'ok') {
    const returned = Number.isFinite(Number(literature.returned_results))
      ? Number(literature.returned_results).toLocaleString()
      : 'an unspecified number'
    const total = Number.isFinite(Number(literature.total_results))
      ? Number(literature.total_results).toLocaleString()
      : 'an unspecified total'
    return `PubMed returned ${returned} of ${total} name-matched records.`
  }
  if (literature?.status === 'no_results') return 'PubMed returned no name-matched records for this pair.'
  if (literature?.status === 'error') return 'PubMed retrieval was unavailable.'
  return 'PubMed retrieval status was unavailable.'
}

function validPubMedUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'pubmed.ncbi.nlm.nih.gov' ? url.href : null
  } catch {
    return null
  }
}

export default function Evidence() {
  const [searchParams] = useSearchParams()
  const initialAId = searchParams.get('drug_a_id') || ''
  const initialBId = searchParams.get('drug_b_id') || ''
  const scoreParam = searchParams.get('score')
  const score = scoreParam === null || scoreParam.trim() === '' ? Number.NaN : Number(scoreParam)
  const [drugA, setDrugA] = useState(null)
  const [drugB, setDrugB] = useState(null)
  const [data, setData] = useState(null)
  const [resolving, setResolving] = useState(Boolean(initialAId || initialBId))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAllExcerpts, setShowAllExcerpts] = useState(false)

  useEffect(() => {
    if (!initialAId && !initialBId) return undefined
    let active = true
    Promise.all([resolveDrug(initialAId), resolveDrug(initialBId)])
      .then(([resolvedA, resolvedB]) => {
        if (!active) return
        setDrugA(resolvedA)
        setDrugB(resolvedB)
        if ((initialAId && !resolvedA) || (initialBId && !resolvedB)) {
          setError('One of the requested DrugBank identifiers could not be resolved.')
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'The requested pair could not be resolved.')
      })
      .finally(() => {
        if (active) setResolving(false)
      })
    return () => {
      active = false
    }
  }, [initialAId, initialBId])

  const pairReady = drugA && drugB && drugA.entity_id !== drugB.entity_id

  function selectDrugA(value) {
    setDrugA(value)
    setData(null)
    setShowAllExcerpts(false)
    setError('')
  }

  function selectDrugB(value) {
    setDrugB(value)
    setData(null)
    setShowAllExcerpts(false)
    setError('')
  }

  async function loadEvidence(event) {
    event.preventDefault()
    if (!pairReady) {
      setError('Choose two different drugs from the search results.')
      return
    }
    setLoading(true)
    setError('')
    setData(null)
    setShowAllExcerpts(false)
    try {
      setData(await getJson(pairEndpoint('/api/evidence/pair', drugA.entity_id, drugB.entity_id)))
    } catch (requestError) {
      setError(requestError.message || 'External evidence could not be retrieved.')
    } finally {
      setLoading(false)
    }
  }

  const labelEvidence = data?.label_evidence
  const evidenceItems = labelEvidence?.pair_evidence || []
  const visibleEvidenceItems = showAllExcerpts
    ? evidenceItems
    : evidenceItems.slice(0, INITIAL_LABEL_EXCERPTS)
  const literature = data?.literature
  const papers = literature?.papers || []
  const fdaUnavailable = labelEvidence && [labelEvidence.drug_a?.status, labelEvidence.drug_b?.status].some((status) => status === 'error')
  const limitations = Array.isArray(data?.limitations) ? data.limitations : []

  return (
    <section className="page evidence-page">
      <div className="page-heading">
        <span className="eyebrow">Independent external sources</span>
        <h1>Evidence</h1>
        <p>
          Review openFDA label text and related PubMed records retrieved
          independently from the R-GCN ranking score.
        </p>
      </div>

      <form className="pair-form evidence-pair-form" onSubmit={loadEvidence}>
        <div className="evidence-form-heading">
          <span className="eyebrow">Evidence query</span>
          <h2>Choose two drugs</h2>
          <p>Select a pair to retrieve independent openFDA and PubMed information.</p>
        </div>
        <div className="drug-selection-field">
          <DrugAutocomplete label="Drug A" selection={drugA} onSelect={selectDrugA} disabled={resolving || loading} />
          <MedicineLabelScanner targetLabel="Drug A" onDrugSelect={selectDrugA} disabled={resolving || loading} />
        </div>
        <div className="drug-selection-field">
          <DrugAutocomplete label="Drug B" selection={drugB} onSelect={selectDrugB} disabled={resolving || loading} />
          <MedicineLabelScanner targetLabel="Drug B" onDrugSelect={selectDrugB} disabled={resolving || loading} />
        </div>
        <button className="primary-button evidence-submit-button" type="submit" disabled={!pairReady || loading || resolving}>
          {loading || resolving ? <LoaderCircle className="spin" size={18} /> : <FileSearch size={18} />}
          {loading ? 'Retrieving sources…' : 'Review evidence'}
        </button>
      </form>

      {error && <div className="inline-alert error evidence-page-state" role="alert"><AlertCircle size={20} />{error}</div>}
      {loading && <div className="empty-feature-state evidence-page-state" role="status" aria-live="polite"><LoaderCircle className="spin" size={28} /><div><strong>Retrieving external sources…</strong><p>openFDA label information and PubMed records are being retrieved independently.</p></div></div>}
      {!data && !loading && !error && <div className="empty-feature-state evidence-page-state"><BookOpen size={28} /><div><strong>Choose a drug pair.</strong><p>FDA label and PubMed retrieval will remain visibly separate from model output.</p></div></div>}

      {data && (
        <>
          <div className="evidence-query-context">
            <span className="eyebrow">Current drug pair</span>
            <div className="evidence-pair-display">
              <article>
                <span>Drug A</span>
                <strong>{drugA?.name}</strong>
                <small>{drugA?.entity_id}</small>
              </article>
              <span className="evidence-pair-connector" aria-hidden="true">+</span>
              <article>
                <span>Drug B</span>
                <strong>{drugB?.name}</strong>
                <small>{drugB?.entity_id}</small>
              </article>
            </div>
          </div>
          <div className="evidence-separation-grid">
            <article className="model-result-card">
              <span>Navigation context</span>
              <h2>Predictor context</h2>
              {Number.isFinite(score) ? <strong>{score.toFixed(4)}</strong> : <strong className="evidence-muted-value">No score supplied</strong>}
              <p>{Number.isFinite(score) ? 'Raw ranking score passed from the Predictor page. This value is carried through navigation and is not recomputed here. It is not a probability, confidence measure, or clinical-risk estimate.' : 'This external-information request was started without a score from the Predictor page.'}</p>
            </article>
            <article className="external-source-card">
              <span>Independent external information</span>
              <h2>openFDA + PubMed</h2>
              <div className="evidence-source-counts">
                <div><strong>{evidenceItems.length.toLocaleString()}</strong><span>label excerpts</span></div>
                <div><strong>{papers.length.toLocaleString()}</strong><span>PubMed records</span></div>
              </div>
              <p>openFDA and PubMed information is retrieved independently of the R-GCN model. It was not used as model input, does not explain the model score, and does not validate or prove a predicted drug–drug interaction.</p>
            </article>
          </div>

          <section className="evidence-panel" aria-labelledby="retrieved-evidence-summary-title">
            <div className="panel-title"><FileSearch size={21} /><div><span>External source orientation</span><h2 id="retrieved-evidence-summary-title">Retrieved evidence summary</h2></div></div>
            <div>
              <p>{labelAvailabilitySummary(labelEvidence)}</p>
              <ul aria-label="openFDA retrieval status by medicine">
                <li>{labelStatusSummary(labelEvidence?.drug_a, drugA?.name || 'Drug A')}</li>
                <li>{labelStatusSummary(labelEvidence?.drug_b, drugB?.name || 'Drug B')}</li>
              </ul>
              <p>{pairMentionSummary(evidenceItems)}</p>
              <p>{pubMedSummary(literature)}</p>
            </div>
            <p>These retrieval results summarize source availability and name mentions only. They do not determine interaction severity, probability, or personal safety, and missing evidence is not proof of safety.</p>
          </section>

          <div className="evidence-record-heading">
            <span className="eyebrow">Retrieved sources</span>
            <h2>Evidence records</h2>
          </div>
          <div className="evidence-grid">
            <article className="evidence-panel">
              <div className="panel-title"><FileSearch size={21} /><div><span>Source: openFDA Drug Label</span><h2>Explicit label mentions</h2></div></div>
              {evidenceItems.length ? (
                <div>
                  <div className="evidence-items">
                    {visibleEvidenceItems.map((item, index) => (
                      <details key={`${item.source_drug}-${item.section}-${index}`} open={index === 0}>
                        <summary><strong>{item.source_drug} mentions {item.mentioned_drug}</strong><span>{SECTION_NAMES[item.section] || item.section}</span></summary>
                        <blockquote>{item.snippet}</blockquote>
                        <dl className="evidence-metadata"><div><dt>Section</dt><dd>{SECTION_NAMES[item.section] || item.section}</dd></div><div><dt>SPL Set ID</dt><dd>{item.spl_set_id || 'Not provided'}</dd></div><div><dt>Effective time</dt><dd>{item.effective_time || 'Not provided'}</dd></div></dl>
                      </details>
                    ))}
                  </div>
                  {evidenceItems.length > INITIAL_LABEL_EXCERPTS && (
                    <div className="evidence-list-control">
                      <p>
                        Showing {visibleEvidenceItems.length.toLocaleString()} of {evidenceItems.length.toLocaleString()} retrieved label excerpts.
                        All excerpts remain available.
                      </p>
                      <button type="button" className="secondary-button" aria-expanded={showAllExcerpts} onClick={() => setShowAllExcerpts((current) => !current)}>
                        {showAllExcerpts ? 'Show fewer excerpts' : `Show all ${evidenceItems.length.toLocaleString()} excerpts`}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className={`source-state ${fdaUnavailable ? 'error' : ''}`}><strong>{fdaUnavailable ? 'FDA label retrieval was partially or fully unavailable.' : 'No explicit cross-drug label mention was retrieved.'}</strong><p>This does not establish that the pair is safe or that no interaction exists.</p></div>
              )}
            </article>

            <article className="evidence-panel">
              <div className="panel-title"><BookOpen size={21} /><div><span>Source: PubMed</span><h2>Related literature</h2></div></div>
              {papers.length ? (
                <div className="paper-list">
                  {papers.map((paper) => {
                    const url = validPubMedUrl(paper.url)
                    return <article key={paper.pmid}><h3>{paper.title || `PMID ${paper.pmid}`}</h3><p>{[paper.authors?.join(', '), paper.journal, paper.publication_date].filter(Boolean).join(' · ')}</p><div><span>PMID {paper.pmid}</span>{url && <a href={url} target="_blank" rel="noopener noreferrer">View on PubMed <ExternalLink size={14} /></a>}</div></article>
                  })}
                </div>
              ) : (
                <div className={`source-state ${literature?.status === 'error' ? 'error' : ''}`}><strong>{literature?.status === 'error' ? 'PubMed literature could not be retrieved.' : 'No related PubMed records were retrieved.'}</strong><p>Unavailable or empty retrieval does not indicate safety, absence of a DDI, or absence of relevant literature.</p></div>
              )}
            </article>
          </div>

          <aside className="limitations-card"><AlertCircle size={21} /><div><strong>Retrieval and interpretation limitations</strong><ul>{limitations.map((item) => <li key={item}>{item}</li>)}</ul></div></aside>
        </>
      )}
    </section>
  )
}
