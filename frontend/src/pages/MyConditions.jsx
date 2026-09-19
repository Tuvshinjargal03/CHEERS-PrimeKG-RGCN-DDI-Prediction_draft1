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
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getJson } from '../lib/api.js'
import './PublicProduct.css'
import './MyConditions.css'

const STORAGE_KEY = 'cheers.my-conditions.v1'
const MAX_CONDITIONS = 10
const SEARCH_DELAY_MS = 180

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

function relationTypeCounts(relationships) {
  if (!Array.isArray(relationships)) return []
  const counts = new Map()
  for (const relationship of relationships) {
    const relation = String(relationship?.relation || '').trim()
    if (relation) counts.set(relation, (counts.get(relation) || 0) + 1)
  }
  return [...counts.entries()]
}

function ConditionAutocomplete({ selection, savedIds, onSelect, disabled }) {
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const requestIdRef = useRef(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const closeMenu = useCallback(() => {
    requestIdRef.current += 1
    setOpen(false)
    setLoading(false)
    setActiveIndex(-1)
  }, [])

  useEffect(() => {
    if (!open || selection) return undefined
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return undefined

    let requestId = null
    const timer = window.setTimeout(async () => {
      requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(true)
      setError('')
      try {
        const payload = await getJson(`/api/public/search?q=${encodeURIComponent(normalizedQuery)}`)
        if (requestIdRef.current !== requestId) return
        setResults(diseaseCandidates(payload))
      } catch (requestError) {
        if (requestIdRef.current !== requestId) return
        setResults([])
        setError(requestError.message || 'Condition search could not be completed.')
      } finally {
        if (requestIdRef.current === requestId) setLoading(false)
      }
    }, SEARCH_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      if (requestId !== null && requestIdRef.current === requestId) requestIdRef.current += 1
    }
  }, [open, query, selection])

  useEffect(() => {
    if (!open) return undefined
    function closeIfOutside(event) {
      if (!rootRef.current?.contains(event.target)) closeMenu()
    }
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('focusin', closeIfOutside, true)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('focusin', closeIfOutside, true)
    }
  }, [closeMenu, open])

  function choose(condition) {
    if (savedIds.has(condition.entity_id)) return
    requestIdRef.current += 1
    onSelect(condition)
    setQuery('')
    setResults([])
    setOpen(false)
    setLoading(false)
    setError('')
    setActiveIndex(-1)
  }

  function clear() {
    requestIdRef.current += 1
    onSelect(null)
    setQuery('')
    setResults([])
    setOpen(true)
    setLoading(false)
    setError('')
    setActiveIndex(-1)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div className="my-conditions-autocomplete" ref={rootRef}>
      <label htmlFor={inputId}>Search condition</label>
      <div className={`my-conditions-autocomplete-control ${selection ? 'is-selected' : ''}`}>
        <Search size={20} aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
          value={selection?.name || query}
          onFocus={() => !disabled && setOpen(true)}
          onClick={() => !disabled && setOpen(true)}
          onChange={(event) => {
            if (selection) onSelect(null)
            requestIdRef.current += 1
            setQuery(event.target.value)
            setResults([])
            setError('')
            setActiveIndex(-1)
            setLoading(Boolean(event.target.value.trim()))
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              closeMenu()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              if (results.length) setActiveIndex((current) => Math.min(current + 1, results.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (results.length) setActiveIndex((current) => current <= 0 ? results.length - 1 : current - 1)
            } else if (event.key === 'Enter' && open && activeIndex >= 0) {
              event.preventDefault()
              choose(results[activeIndex])
            }
          }}
          placeholder="Type part of a condition name, such as diab"
          autoComplete="off"
          disabled={disabled}
        />
        {loading && <span className="my-conditions-autocomplete-loading">Searching…</span>}
        {(query || selection) && !disabled && (
          <button type="button" className="icon-button" onClick={clear} aria-label="Clear condition search">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {selection && <small className="my-conditions-selection-meta">Selected CHEERS condition · {selection.entity_id}</small>}

      {open && !selection && (
        <div id={listboxId} className="my-conditions-suggestions" role="listbox" aria-label="Condition suggestions">
          {!query.trim() ? (
            <div className="my-conditions-suggestion-message">
              <strong>Browse conditions</strong>
              <span>Type part of a condition name to search existing CHEERS disease entities.</span>
            </div>
          ) : error ? (
            <div className="my-conditions-suggestion-message is-error" role="alert">{error}</div>
          ) : results.length ? results.map((condition, index) => {
            const saved = savedIds.has(condition.entity_id)
            return (
              <button
                id={`${inputId}-option-${index}`}
                key={condition.entity_id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                disabled={saved}
                className={index === activeIndex ? 'is-active' : ''}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(condition)}
              >
                <span><strong>{condition.name}</strong><small>{condition.entity_id}</small></span>
                {saved && <em>Saved</em>}
              </button>
            )
          }) : (
            <div className="my-conditions-suggestion-message">
              {loading ? 'Searching CHEERS conditions…' : 'No matching CHEERS condition found. Try another part of the name.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
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
  const otherRelationTypes = relationTypeCounts(otherRelationships)
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
              <span>other typed biomedical relationships</span>
            </div>
            {nutritionAvailable && (
              <div>
                <Utensils size={17} aria-hidden="true" />
                <CheckCircle2 size={15} aria-label="Available" />
                <span>Nutrition &amp; lifestyle available</span>
              </div>
            )}
          </div>
          {otherRelationTypes.length > 0 && (
            <div className="my-conditions-relation-types" aria-label={`Other relationship types for ${condition.name}`}>
              {otherRelationTypes.map(([relation, count]) => <span key={relation}>{relation} <b>{count}</b></span>)}
            </div>
          )}
        </>
      )}

      <nav className="my-conditions-actions" aria-label={`Actions for ${condition.name}`}>
        <Link className="is-primary" to={profilePath}>View condition</Link>
        {!loading && !error && indicationCount > 0 && (
          <Link to={medicineQuery}>View linked medicines</Link>
        )}
        {nutritionAvailable && (
          <Link to={`${profilePath}?section=nutrition-lifestyle`}>Nutrition &amp; lifestyle</Link>
        )}
      </nav>
    </article>
  )
}

export default function MyConditions() {
  const [conditions, setConditions] = useState(loadConditions)
  const [pendingCondition, setPendingCondition] = useState(null)
  const atLimit = conditions.length >= MAX_CONDITIONS
  const savedIds = new Set(conditions.map((condition) => condition.entity_id))

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conditions))
    } catch {
      // The page remains usable for this session when browser storage is unavailable.
    }
  }, [conditions])

  function saveCondition(event) {
    event.preventDefault()
    const condition = compactCondition(pendingCondition)
    if (
      !condition
      || atLimit
      || conditions.some((item) => item.entity_id === condition.entity_id)
    ) return
    setConditions((current) => [...current, condition])
    setPendingCondition(null)
  }

  function removeCondition(entityId) {
    setConditions((current) => current.filter((condition) => condition.entity_id !== entityId))
  }

  function clearConditions() {
    setConditions([])
  }

  return (
    <section className="page product-page my-conditions-page">
      <header className="product-page-header">
        <span className="eyebrow">My Conditions</span>
        <h1>Save conditions you want to explore in CHEERS.</h1>
        <p>Saving a condition connects it with available condition information, typed medicine–condition relationships, reviewed nutrition and lifestyle modules, and the combined My Health view.</p>
      </header>

      <section className="product-input-panel my-conditions-builder" aria-labelledby="my-conditions-search-title">
        <div className="my-conditions-builder-heading">
          <div>
            <span className="eyebrow">Condition list</span>
            <h2 id="my-conditions-search-title">Find a condition</h2>
          </div>
          <span className="product-step-badge">{conditions.length} / {MAX_CONDITIONS} conditions</span>
        </div>

        <form className="my-conditions-search" role="search" onSubmit={saveCondition}>
          <ConditionAutocomplete
            selection={pendingCondition}
            savedIds={savedIds}
            onSelect={setPendingCondition}
            disabled={atLimit}
          />
          <button className="secondary-button" type="submit" disabled={!pendingCondition || atLimit}>
            <Plus size={17} aria-hidden="true" /> Save condition
          </button>
        </form>

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
            <div><strong>Save a condition to organize its available CHEERS information.</strong><p>Use Browse conditions above to find a canonical disease entity, then open its details, typed medicine relationships, nutrition information when available, and My Health connections.</p></div>
          </div>
        )}
      </section>

      <div>
        <p>Your saved conditions also appear alongside saved medicines in My Health.</p>
        <Link className="secondary-button" to="/my-health">View in My Health <ArrowRight size={17} aria-hidden="true" /></Link>
      </div>

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
