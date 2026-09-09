import {
  AlertCircle,
  BookOpen,
  ChevronRight,
  ClipboardList,
  FileSearch,
  Info,
  LoaderCircle,
  Pill,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import { G3_CONTEXT_CANDIDATE_IDS } from '../data/g3ContextCandidateIds.js'
import { getJson, pairEndpoint } from '../lib/api.js'
import { generateUniqueMedicinePairs } from '../lib/myMedicines.js'
import { derivePairReviewStatus } from '../lib/pairStatus.js'
import './PublicProduct.css'
import './MyMedicines.css'

const STORAGE_KEY = 'cheers.my-medicines.v1'
const MAX_MEDICINES = 8
const CONTEXT_IDS = new Set(G3_CONTEXT_CANDIDATE_IDS)

function compactMedicine(medicine) {
  if (
    !medicine
    || typeof medicine.entity_id !== 'string'
    || typeof medicine.name !== 'string'
    || !medicine.entity_id.trim()
    || !medicine.name.trim()
  ) {
    return null
  }

  return {
    entity_id: medicine.entity_id.trim().toUpperCase(),
    name: medicine.name.trim(),
  }
}

function loadMedicines() {
  if (typeof window === 'undefined') return []

  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return []

    const seen = new Set()
    return stored.reduce((medicines, item) => {
      const medicine = compactMedicine(item)
      if (!medicine || seen.has(medicine.entity_id) || medicines.length >= MAX_MEDICINES) {
        return medicines
      }
      seen.add(medicine.entity_id)
      medicines.push(medicine)
      return medicines
    }, [])
  } catch {
    return []
  }
}

function pairParams(pair) {
  return new URLSearchParams({
    drug_a_id: pair.drugA.entity_id,
    drug_b_id: pair.drugB.entity_id,
  }).toString()
}

function hasGraphContext(pair) {
  return CONTEXT_IDS.has(pair.drugA.entity_id) && CONTEXT_IDS.has(pair.drugB.entity_id)
}

function StatusIcon({ status }) {
  if (status === 'important') return <ShieldAlert size={21} aria-hidden="true" />
  if (status === 'review') return <Info size={21} aria-hidden="true" />
  return <AlertCircle size={21} aria-hidden="true" />
}

function PairResultCard({ result, index }) {
  const { pair, status, evidence, failed } = result
  const params = pairParams(pair)
  const labelItems = evidence?.label_evidence?.pair_evidence
  const papers = evidence?.literature?.papers
  const labelCount = failed ? null : Array.isArray(labelItems) ? labelItems.length : 0
  const paperCount = failed ? null : Array.isArray(papers) ? papers.length : 0
  const question = `${pair.drugA.name} with ${pair.drugB.name}`

  return (
    <article className={`my-medicines-pair-card is-${status.key}`}>
      <div className="my-medicines-pair-heading">
        <span className="my-medicines-status-icon"><StatusIcon status={status.key} /></span>
        <div>
          <span>Combination {index + 1}</span>
          <h3>{pair.drugA.name} <b aria-hidden="true">+</b> {pair.drugB.name}</h3>
        </div>
        <strong className="my-medicines-status-label">{status.title}</strong>
      </div>

      <p className="my-medicines-status-copy">{status.description}</p>
      {failed && (
        <p className="my-medicines-pair-error" role="alert">
          Sources could not be retrieved for this combination. The remaining combinations were still checked.
        </p>
      )}

      <div className="my-medicines-source-counts" aria-label={`Retrieved source counts for ${pair.drugA.name} and ${pair.drugB.name}`}>
        <div>
          <FileSearch size={17} aria-hidden="true" />
          <strong>{labelCount ?? '—'}</strong>
          <span>FDA label {labelCount === 1 ? 'mention' : 'mentions'}</span>
        </div>
        <div>
          <BookOpen size={17} aria-hidden="true" />
          <strong>{paperCount ?? '—'}</strong>
          <span>PubMed {paperCount === 1 ? 'record' : 'records'}</span>
        </div>
      </div>

      <nav className="my-medicines-pair-actions" aria-label={`Actions for ${pair.drugA.name} and ${pair.drugB.name}`}>
        <Link to={`/search?q=${encodeURIComponent(question)}`}>Review pair</Link>
        <Link to={`/check?${params}`}>Open Medicine Checker</Link>
        <Link to={`/evidence?${params}`}>Review sources</Link>
        {hasGraphContext(pair) && (
          <Link to={`/graph?${params}`}>Explore biomedical connections</Link>
        )}
      </nav>
    </article>
  )
}

export default function MyMedicines() {
  const [medicines, setMedicines] = useState(loadMedicines)
  const [pendingMedicine, setPendingMedicine] = useState(null)
  const [results, setResults] = useState([])
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const runIdRef = useRef(0)

  const duplicatePending = Boolean(
    pendingMedicine
    && medicines.some((medicine) => medicine.entity_id === pendingMedicine.entity_id?.toUpperCase()),
  )
  const atLimit = medicines.length >= MAX_MEDICINES
  const expectedPairCount = (medicines.length * (medicines.length - 1)) / 2
  const reviewComplete = !checking && results.length > 0 && results.length === expectedPairCount
  const summary = useMemo(() => results.reduce((counts, result) => ({
    ...counts,
    [result.status.key]: counts[result.status.key] + 1,
  }), { important: 0, review: 0, insufficient: 0 }), [results])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(medicines))
    } catch {
      // The feature remains usable for this session when browser storage is unavailable.
    }
  }, [medicines])

  useEffect(() => () => {
    runIdRef.current += 1
  }, [])

  function resetReview() {
    runIdRef.current += 1
    setResults([])
    setChecking(false)
    setProgress({ current: 0, total: 0 })
  }

  function addMedicine(event) {
    event.preventDefault()
    const medicine = compactMedicine(pendingMedicine)
    if (!medicine || duplicatePending || atLimit) return

    setMedicines((current) => [...current, medicine])
    setPendingMedicine(null)
    resetReview()
  }

  function removeMedicine(entityId) {
    setMedicines((current) => current.filter((medicine) => medicine.entity_id !== entityId))
    resetReview()
  }

  function clearMedicines() {
    setMedicines([])
    setPendingMedicine(null)
    resetReview()
  }

  async function checkCombinations() {
    const pairs = generateUniqueMedicinePairs(medicines)
    if (!pairs.length || checking) return

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setResults([])
    setChecking(true)
    setProgress({ current: 1, total: pairs.length })

    for (let index = 0; index < pairs.length; index += 1) {
      if (runIdRef.current !== runId) return
      const pair = pairs[index]
      setProgress({ current: index + 1, total: pairs.length })

      let evidence = null
      let failed = false
      try {
        evidence = await getJson(
          pairEndpoint('/api/evidence/pair', pair.drugA.entity_id, pair.drugB.entity_id),
        )
      } catch {
        failed = true
      }

      if (runIdRef.current !== runId) return
      setResults((current) => [
        ...current,
        {
          pair,
          evidence,
          failed,
          status: derivePairReviewStatus(evidence, failed),
        },
      ])
    }

    if (runIdRef.current === runId) setChecking(false)
  }

  return (
    <section className="page product-page my-medicines-page">
      <header className="product-page-header">
        <span className="eyebrow">My Medicines</span>
        <h1>Review your medicines together.</h1>
        <p>Add medicines you want to review together.</p>
      </header>

      <section className="product-input-panel my-medicines-builder" aria-labelledby="my-medicines-builder-title">
        <div className="my-medicines-builder-heading">
          <div>
            <span className="eyebrow">Medicine list</span>
            <h2 id="my-medicines-builder-title">Build your list</h2>
          </div>
          <span className="product-step-badge">{medicines.length} / {MAX_MEDICINES} medicines</span>
        </div>

        <form className="my-medicines-add" onSubmit={addMedicine}>
          <DrugAutocomplete
            label="Search medicine"
            selection={pendingMedicine}
            onSelect={setPendingMedicine}
            placeholder="Search by medicine name or DrugBank ID"
            disabled={checking || atLimit}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={!pendingMedicine || duplicatePending || atLimit || checking}
          >
            <Plus size={17} aria-hidden="true" /> Add medicine
          </button>
        </form>

        {duplicatePending && (
          <p className="my-medicines-form-note" role="status">
            <Info size={15} aria-hidden="true" /> This medicine is already in your list.
          </p>
        )}
        {atLimit && (
          <p className="my-medicines-form-note" role="status">
            <Info size={15} aria-hidden="true" /> You can review up to {MAX_MEDICINES} medicines at a time.
          </p>
        )}

        <div className="my-medicines-selected-heading">
          <strong>Selected</strong>
          {medicines.length > 0 && (
            <button type="button" onClick={clearMedicines} disabled={checking}>
              <Trash2 size={14} aria-hidden="true" /> Clear my medicines
            </button>
          )}
        </div>

        {medicines.length ? (
          <ul className="my-medicines-selected-list" aria-label="Selected medicines">
            {medicines.map((medicine) => (
              <li key={medicine.entity_id}>
                <Pill size={15} aria-hidden="true" />
                <span><strong>{medicine.name}</strong><small>{medicine.entity_id}</small></span>
                <button
                  type="button"
                  onClick={() => removeMedicine(medicine.entity_id)}
                  disabled={checking}
                  aria-label={`Remove ${medicine.name}`}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="my-medicines-empty-list">No medicines added yet.</p>
        )}

        <div className="my-medicines-builder-actions">
          <button
            className="primary-button"
            type="button"
            onClick={checkCombinations}
            disabled={medicines.length < 2 || checking}
          >
            {checking ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <ClipboardList size={18} aria-hidden="true" />}
            {checking ? 'Checking combinations…' : 'Check combinations'}
          </button>
          {medicines.length < 2 && <span>Add at least two medicines to check combinations.</span>}
        </div>

        <p className="my-medicines-privacy">
          This list stays in this browser on this device. CHEERS stores only the medicine names and IDs needed for this feature, and you can clear them at any time.
        </p>
      </section>

      {checking && (
        <div className="my-medicines-progress" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <div>
            <strong>Checking {progress.current} of {progress.total} combinations…</strong>
            <p>Each pair is checked in order so external requests stay controlled.</p>
          </div>
        </div>
      )}

      {(checking || results.length > 0) && (
        <section className="my-medicines-review" aria-labelledby="my-medicines-review-title">
          <div className="product-section-title">
            <div>
              <span className="eyebrow">Available source information</span>
              <h2 id="my-medicines-review-title">Your medicine review</h2>
            </div>
          </div>

          {reviewComplete && (
            <div className="my-medicines-summary" aria-label="Medicine review summary">
              <article><strong>{medicines.length}</strong><span>{medicines.length === 1 ? 'medicine' : 'medicines'}</span></article>
              <article><strong>{results.length}</strong><span>{results.length === 1 ? 'combination' : 'combinations'} checked</span></article>
              <article className="is-important"><strong>{summary.important}</strong><span>{summary.important === 1 ? 'interaction warning' : 'interaction warnings'}</span></article>
              <article className="is-review"><strong>{summary.review}</strong><span>needs review</span></article>
              <article className="is-insufficient"><strong>{summary.insufficient}</strong><span>not enough information</span></article>
            </div>
          )}

          <div className="my-medicines-pair-list">
            {results.map((result, index) => (
              <PairResultCard
                key={`${result.pair.drugA.entity_id}-${result.pair.drugB.entity_id}`}
                result={result}
                index={index}
              />
            ))}
          </div>
        </section>
      )}

      <p className="product-page-boundary my-medicines-boundary">
        <Info size={15} aria-hidden="true" />
        CHEERS reviews available source-backed information for the medicines you select. It does not determine whether a medicine combination is personally safe or appropriate.
      </p>

      <Link className="my-medicines-checker-link" to="/check">
        Check one medicine pair in detail <ChevronRight size={17} aria-hidden="true" />
      </Link>
    </section>
  )
}
