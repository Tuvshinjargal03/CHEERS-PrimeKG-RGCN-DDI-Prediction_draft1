import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GitBranch,
  HeartPulse,
  Info,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  Utensils,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getJson } from '../lib/api.js'
import './PublicProduct.css'
import './MyConditions.css'

const STORAGE_KEY = 'cheers.my-conditions.v1'
const MAX_CONDITIONS = 10

function compactCondition(condition) {
  if (
    !condition
    || typeof condition.entity_id !== 'string'
    || typeof condition.name !== 'string'
    || !condition.entity_id.trim()
    || !condition.name.trim()
  ) {
    return null
  }

  return {
    entity_id: condition.entity_id.trim(),
    name: condition.name.trim(),
  }
}

function loadConditions() {
  if (typeof window === 'undefined') return []

  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return []

    const seen = new Set()
    return stored.reduce((conditions, item) => {
      const condition = compactCondition(item)
      if (!condition || seen.has(condition.entity_id) || conditions.length >= MAX_CONDITIONS) {
        return conditions
      }
      seen.add(condition.entity_id)
      conditions.push(condition)
      return conditions
    }, [])
  } catch {
    return []
  }
}

function diseaseCandidates(payload) {
  const candidates = [
    ...(payload?.recognized_entities || []),
    ...(payload?.ambiguous_matches || []).flatMap((match) => match.candidates || []),
  ].filter((entity) => entity.entity_type === 'disease')
  const seen = new Set()
  return candidates.reduce((items, entity) => {
    const condition = compactCondition(entity)
    if (!condition || seen.has(condition.entity_id)) return items
    seen.add(condition.entity_id)
    items.push(condition)
    return items
  }, [])
}

function boundedDescription(value, limit = 240) {
  const text = String(value || '').trim()
  if (text.length <= limit) return text
  const boundary = text.slice(0, limit + 1).lastIndexOf(' ')
  return `${text.slice(0, boundary > 0 ? boundary : limit).trim()}…`
}

function ConditionCard({ condition, onRemove }) {
  const [request, setRequest] = useState({ conditionId: '', payload: null, error: '' })
  const requestIsCurrent = request.conditionId === condition.entity_id
  const payload = requestIsCurrent ? request.payload : null
  const error = requestIsCurrent ? request.error : ''
  const loading = !requestIsCurrent

  useEffect(() => {
    let active = true
    getJson(`/api/public/disease?disease_id=${encodeURIComponent(condition.entity_id)}`).then(
      (result) => {
        if (active) setRequest({ conditionId: condition.entity_id, payload: result, error: '' })
      },
      (requestError) => {
        if (active) {
          setRequest({
            conditionId: condition.entity_id,
            payload: null,
            error: requestError.message || 'Condition information could not be loaded.',
          })
        }
      },
    )
    return () => {
      active = false
    }
  }, [condition.entity_id])

  const disease = payload?.disease
  const indications = payload?.medicine_relationships?.indications
  const otherRelationships = payload?.medicine_relationships?.other
  const indicationCount = Array.isArray(indications) ? indications.length : null
  const otherCount = Array.isArray(otherRelationships) ? otherRelationships.length : null
  const nutritionAvailable = payload?.nutrition_lifestyle?.status === 'available'
  const description = disease?.verified_description_available
    ? boundedDescription(disease.description)
    : ''
  const profilePath = `/diseases/${encodeURIComponent(condition.entity_id)}`
  const medicineQuery = `/search?q=${encodeURIComponent(`medicines for ${condition.name}`)}`

  return (
    <article className="my-conditions-card">
      <header className="my-conditions-card-heading">
        <span className="my-conditions-card-icon"><HeartPulse size={20} aria-hidden="true" /></span>
        <div>
          <span>Saved condition</span>
          <h3>{condition.name}</h3>
          <small>{condition.entity_id}</small>
        </div>
        <button type="button" onClick={() => onRemove(condition.entity_id)} aria-label={`Remove ${condition.name}`}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {loading && (
        <div className="my-conditions-card-state" role="status">
          <LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading available information…
        </div>
      )}

      {error && (
        <div className="my-conditions-card-state is-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error} The saved condition remains available in this list.</span>
        </div>
      )}

      {!loading && !error && payload && (
        <>
          {description ? (
            <p className="my-conditions-description">{description}</p>
          ) : (
            <p className="my-conditions-description is-unavailable">
              An approved short description is not currently available in CHEERS.
            </p>
          )}

          <div className="my-conditions-facts" aria-label={`Available information for ${condition.name}`}>
            <div>
              <BookOpen size={17} aria-hidden="true" />
              <strong>{indicationCount ?? '—'}</strong>
              <span>medicines linked through indication</span>
            </div>
            <div>
              <GitBranch size={17} aria-hidden="true" />
              <strong>{otherCount ?? '—'}</strong>
              <span>other biomedical relationships</span>
            </div>
            {nutritionAvailable && (
              <div>
                <Utensils size={17} aria-hidden="true" />
                <CheckCircle2 size={15} aria-label="Available" />
                <span>Nutrition &amp; lifestyle available</span>
              </div>
            )}
          </div>
        </>
      )}

      <nav className="my-conditions-actions" aria-label={`Actions for ${condition.name}`}>
        <Link to={profilePath}>View condition</Link>
        {!loading && !error && indicationCount !== null && (
          <Link to={medicineQuery}>Medicines linked through indication</Link>
        )}
        {nutritionAvailable && (
          <Link to={`${profilePath}?section=nutrition-lifestyle`}>Nutrition &amp; lifestyle</Link>
        )}
        {!loading && !error && payload && (
          <Link to={profilePath}>Explore biomedical relationships</Link>
        )}
      </nav>
    </article>
  )
}

export default function MyConditions() {
  const [conditions, setConditions] = useState(loadConditions)
  const [query, setQuery] = useState('')
  const [searchRequest, setSearchRequest] = useState({
    status: 'idle',
    candidates: [],
    message: '',
  })
  const searchIdRef = useRef(0)
  const atLimit = conditions.length >= MAX_CONDITIONS

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conditions))
    } catch {
      // The page remains usable for this session when browser storage is unavailable.
    }
  }, [conditions])

  async function searchConditions(event) {
    event.preventDefault()
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return

    const searchId = searchIdRef.current + 1
    searchIdRef.current = searchId
    setSearchRequest({ status: 'loading', candidates: [], message: '' })
    try {
      const payload = await getJson(`/api/public/search?q=${encodeURIComponent(normalizedQuery)}`)
      if (searchIdRef.current !== searchId) return
      const candidates = diseaseCandidates(payload)
      setSearchRequest({
        status: candidates.length ? 'ready' : 'empty',
        candidates,
        message: candidates.length
          ? ''
          : 'No existing CHEERS disease entity matched that search. Try an exact condition name.',
      })
    } catch (requestError) {
      if (searchIdRef.current !== searchId) return
      setSearchRequest({
        status: 'error',
        candidates: [],
        message: requestError.message || 'Condition search could not be completed.',
      })
    }
  }

  function addCondition(candidate) {
    const condition = compactCondition(candidate)
    if (
      !condition
      || atLimit
      || conditions.some((item) => item.entity_id === condition.entity_id)
    ) return
    setConditions((current) => [...current, condition])
  }

  function removeCondition(entityId) {
    setConditions((current) => current.filter((condition) => condition.entity_id !== entityId))
  }

  function clearConditions() {
    setConditions([])
    setSearchRequest({ status: 'idle', candidates: [], message: '' })
  }

  return (
    <section className="page product-page my-conditions-page">
      <header className="product-page-header">
        <span className="eyebrow">My Conditions</span>
        <h1>Save conditions you want to explore in CHEERS.</h1>
        <p>Keep quick links to available condition information, medicine relationships, and reviewed nutrition resources.</p>
      </header>

      <section className="product-input-panel my-conditions-builder" aria-labelledby="my-conditions-search-title">
        <div className="my-conditions-builder-heading">
          <div>
            <span className="eyebrow">Condition list</span>
            <h2 id="my-conditions-search-title">Find a condition</h2>
          </div>
          <span className="product-step-badge">{conditions.length} / {MAX_CONDITIONS} conditions</span>
        </div>

        <form className="my-conditions-search" role="search" onSubmit={searchConditions}>
          <label htmlFor="my-conditions-query">Search condition</label>
          <div>
            <Search size={20} aria-hidden="true" />
            <input
              id="my-conditions-query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by exact disease name"
              autoComplete="off"
            />
            <button className="secondary-button" type="submit" disabled={!query.trim() || searchRequest.status === 'loading'}>
              {searchRequest.status === 'loading'
                ? <LoaderCircle className="spin" size={17} aria-hidden="true" />
                : <Search size={17} aria-hidden="true" />}
              {searchRequest.status === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        {searchRequest.message && (
          <p className={`my-conditions-search-message ${searchRequest.status === 'error' ? 'is-error' : ''}`} role={searchRequest.status === 'error' ? 'alert' : 'status'}>
            {searchRequest.status === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}
            {searchRequest.message}
          </p>
        )}

        {searchRequest.candidates.length > 0 && (
          <div className="my-conditions-search-results" aria-label="Condition search results">
            {searchRequest.candidates.map((candidate) => {
              const saved = conditions.some((condition) => condition.entity_id === candidate.entity_id)
              return (
                <article key={candidate.entity_id}>
                  <span><strong>{candidate.name}</strong><small>{candidate.entity_id}</small></span>
                  <button type="button" onClick={() => addCondition(candidate)} disabled={saved || atLimit}>
                    {saved ? <CheckCircle2 size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                    {saved ? 'Saved' : 'Add condition'}
                  </button>
                </article>
              )
            })}
          </div>
        )}

        {atLimit && (
          <p className="my-conditions-search-message" role="status">
            <Info size={16} aria-hidden="true" /> You can save up to {MAX_CONDITIONS} conditions.
          </p>
        )}

        <p className="my-conditions-privacy">
          Your selected conditions are stored only in this browser. CHEERS does not use them to diagnose or prescribe treatment.
        </p>
      </section>

      <section className="my-conditions-saved" aria-labelledby="saved-conditions-title">
        <div className="product-section-title">
          <div>
            <span className="eyebrow">Selected conditions</span>
            <h2 id="saved-conditions-title">Your saved conditions</h2>
          </div>
          {conditions.length > 0 && (
            <button type="button" className="my-conditions-clear" onClick={clearConditions}>
              <Trash2 size={15} aria-hidden="true" /> Clear my conditions
            </button>
          )}
        </div>

        {conditions.length ? (
          <div className="my-conditions-grid">
            {conditions.map((condition) => (
              <ConditionCard key={condition.entity_id} condition={condition} onRemove={removeCondition} />
            ))}
          </div>
        ) : (
          <div className="my-conditions-empty">
            <HeartPulse size={25} aria-hidden="true" />
            <div><strong>No conditions saved yet.</strong><p>Search for an existing CHEERS disease entity to add it here.</p></div>
          </div>
        )}
      </section>

      <p className="product-page-boundary my-conditions-boundary">
        <Info size={15} aria-hidden="true" />
        Saved conditions are browsing shortcuts, not a medical record, diagnosis, or treatment recommendation.
      </p>

      <Link className="my-conditions-disease-link" to="/diseases">
        Open Disease Guide <ArrowRight size={17} aria-hidden="true" />
      </Link>
    </section>
  )
}
