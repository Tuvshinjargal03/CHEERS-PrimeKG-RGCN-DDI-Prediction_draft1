import { AlertCircle, BookOpen, ExternalLink, FileSearch, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import { getJson, pairEndpoint, resolveDrug } from '../lib/api.js'

const SECTION_NAMES = {
  drug_interactions: 'Drug interactions',
  contraindications: 'Contraindications',
  boxed_warning: 'Boxed warning',
  warnings: 'Warnings',
  warnings_and_cautions: 'Warnings and cautions',
  precautions: 'Precautions',
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

  async function loadEvidence(event) {
    event.preventDefault()
    if (!pairReady) {
      setError('Choose two different drugs from the search results.')
      return
    }
    setLoading(true)
    setError('')
    setData(null)
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
  const literature = data?.literature
  const papers = literature?.papers || []
  const fdaUnavailable = labelEvidence && [labelEvidence.drug_a?.status, labelEvidence.drug_b?.status].some((status) => status === 'error')
  const limitations = Array.isArray(data?.limitations) ? data.limitations : []

  return (
    <section className="page">
      <div className="page-heading">
        <span className="eyebrow">Independent external sources</span>
        <h1>Evidence</h1>
        <p>
          Review openFDA label text and related PubMed records separately from
          the R-GCN result. External retrieval does not calculate, calibrate, or
          change the model score.
        </p>
      </div>

      <form className="pair-form" onSubmit={loadEvidence}>
        <DrugAutocomplete label="Drug A" selection={drugA} onSelect={(value) => { setDrugA(value); setData(null); setError('') }} disabled={resolving} />
        <DrugAutocomplete label="Drug B" selection={drugB} onSelect={(value) => { setDrugB(value); setData(null); setError('') }} disabled={resolving} />
        <button className="primary-button" type="submit" disabled={!pairReady || loading || resolving}>
          {loading || resolving ? <LoaderCircle className="spin" size={18} /> : <FileSearch size={18} />}
          {loading ? 'Retrieving sources…' : 'Review evidence'}
        </button>
      </form>

      {error && <div className="inline-alert error"><AlertCircle size={20} />{error}</div>}
      {!data && !loading && !error && <div className="empty-feature-state"><BookOpen size={28} /><div><strong>Choose a drug pair.</strong><p>FDA label and PubMed retrieval will remain visibly separate from model output.</p></div></div>}

      {data && (
        <>
          <div className="evidence-separation-grid">
            <article className="model-result-card">
              <span>Navigation context</span>
              <h2>Predictor context</h2>
              {Number.isFinite(score) ? <strong>{score.toFixed(4)}</strong> : <strong>No Predictor score supplied</strong>}
              <p>{Number.isFinite(score) ? 'Raw ranking score passed from the Predictor page. This value is carried through navigation and is not recomputed by the Evidence page. It is not a probability.' : 'This evidence request was started without a score from the Predictor page.'}</p>
            </article>
            <article className="external-source-card">
              <span>External supporting evidence</span>
              <h2>openFDA + PubMed</h2>
              <strong>{evidenceItems.length + papers.length} retrieved items</strong>
              <p>{data.ai_context?.note}</p>
            </article>
          </div>

          <div className="evidence-grid">
            <article className="evidence-panel">
              <div className="panel-title"><FileSearch size={21} /><div><span>Source: openFDA Drug Label</span><h2>Explicit label mentions</h2></div></div>
              {evidenceItems.length ? (
                <div className="evidence-items">
                  {evidenceItems.map((item, index) => (
                    <details key={`${item.source_drug}-${item.section}-${index}`} open={index === 0}>
                      <summary><strong>{item.source_drug} mentions {item.mentioned_drug}</strong><span>{SECTION_NAMES[item.section] || item.section}</span></summary>
                      <blockquote>{item.snippet}</blockquote>
                      <dl className="evidence-metadata"><div><dt>Section</dt><dd>{SECTION_NAMES[item.section] || item.section}</dd></div><div><dt>SPL Set ID</dt><dd>{item.spl_set_id || 'Not provided'}</dd></div><div><dt>Effective time</dt><dd>{item.effective_time || 'Not provided'}</dd></div></dl>
                    </details>
                  ))}
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
                <div className={`source-state ${literature?.status === 'error' ? 'error' : ''}`}><strong>{literature?.status === 'error' ? 'PubMed literature could not be retrieved.' : 'No related PubMed records were retrieved.'}</strong><p>Unavailable or empty retrieval does not mean relevant literature is absent.</p></div>
              )}
            </article>
          </div>

          <aside className="limitations-card"><AlertCircle size={21} /><div><strong>Retrieval and interpretation limitations</strong><ul>{limitations.map((item) => <li key={item}>{item}</li>)}</ul></div></aside>
        </>
      )}
    </section>
  )
}
