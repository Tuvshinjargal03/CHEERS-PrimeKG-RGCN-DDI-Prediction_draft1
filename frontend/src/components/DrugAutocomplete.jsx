import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { getJson } from '../lib/api.js'

export default function DrugAutocomplete({
  label,
  selection,
  onSelect,
  placeholder = 'Search by drug name or DrugBank ID',
  disabled = false,
}) {
  const inputId = useId()
  const requestId = useRef(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const trimmed = query.trim()
    if (selection || trimmed.length < 2) return undefined

    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const data = await getJson(
          `/api/drugs/search?q=${encodeURIComponent(trimmed)}&limit=8`,
        )
        if (requestId.current !== currentRequest) return
        setResults(data.results || [])
        setOpen(true)
      } catch {
        if (requestId.current !== currentRequest) return
        setResults([])
        setOpen(true)
      } finally {
        if (requestId.current === currentRequest) setLoading(false)
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [query, selection])

  function clear() {
    requestId.current += 1
    setQuery('')
    setResults([])
    setOpen(false)
    onSelect(null)
  }

  return (
    <div className="drug-autocomplete">
      <label htmlFor={inputId}>{label}</label>
      <div className={`autocomplete-control ${selection ? 'selected' : ''}`}>
        <Search size={18} aria-hidden="true" />
        <input
          id={inputId}
          value={selection?.name || query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          onChange={(event) => {
            if (selection) onSelect(null)
            const nextQuery = event.target.value
            setQuery(nextQuery)
            if (nextQuery.trim().length < 2) {
              requestId.current += 1
              setResults([])
              setOpen(false)
              setLoading(false)
            }
          }}
          onFocus={() => {
            if (!selection && query.trim().length >= 2) setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        />
        {loading && <span className="autocomplete-loading">Searching…</span>}
        {(query || selection) && !disabled && (
          <button type="button" className="icon-button" onClick={clear} aria-label={`Clear ${label}`}>
            <X size={16} />
          </button>
        )}
      </div>

      {selection && (
        <span className="selection-meta">
          Selected: {selection.name} · {selection.entity_id}
        </span>
      )}

      {open && !selection && (
        <div className="autocomplete-menu" role="listbox" aria-label={`${label} results`}>
          {results.length ? (
            results.map((item) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={`${item.entity_id}-${item.node_id}`}
                onClick={() => {
                  onSelect(item)
                  setQuery('')
                  setOpen(false)
                }}
              >
                <span>{item.name}</span>
                <small>{item.entity_id}</small>
              </button>
            ))
          ) : (
            <div className="autocomplete-empty">
              {loading ? 'Searching…' : 'No matching drugs found.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
