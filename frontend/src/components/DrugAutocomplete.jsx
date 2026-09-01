import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { getJson } from '../lib/api.js'

const PAGE_SIZE = 50
const SEARCH_DELAY_MS = 180

export default function DrugAutocomplete({
  label,
  selection,
  onSelect,
  placeholder = 'Search by drug name or DrugBank ID',
  disabled = false,
}) {
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const requestId = useRef(0)
  const menuRef = useRef(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const fetchPage = useCallback(async (searchQuery, offset, append) => {
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setLoading(true)
    setSearchError('')

    try {
      const params = new URLSearchParams({
        q: searchQuery,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      const data = await getJson(`/api/drugs/search?${params.toString()}`)
      if (requestId.current !== currentRequest) return

      const nextResults = data.results || []
      setResults((current) => {
        if (!append) return nextResults
        const seen = new Set(current.map((item) => `${item.entity_id}-${item.node_id}`))
        return [
          ...current,
          ...nextResults.filter((item) => !seen.has(`${item.entity_id}-${item.node_id}`)),
        ]
      })
      setHasMore(Boolean(data.has_more))
      setOpen(true)
    } catch {
      if (requestId.current !== currentRequest) return
      if (!append) setResults([])
      setHasMore(false)
      setSearchError('Drug search is unavailable. Please try again.')
      setOpen(true)
    } finally {
      if (requestId.current === currentRequest) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selection || !open) return undefined

    const trimmed = query.trim()
    const timer = window.setTimeout(
      () => fetchPage(trimmed, 0, false),
      trimmed ? SEARCH_DELAY_MS : 0,
    )

    return () => window.clearTimeout(timer)
  }, [fetchPage, open, query, selection])

  useEffect(() => {
    if (activeIndex < 0) return
    menuRef.current
      ?.querySelector(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function openBrowseMenu() {
    if (selection || disabled) return
    setLoading(true)
    setOpen(true)
  }

  function choose(item) {
    requestId.current += 1
    onSelect(item)
    setQuery('')
    setResults([])
    setHasMore(false)
    setSearchError('')
    setActiveIndex(-1)
    setOpen(false)
    setLoading(false)
  }

  function loadMore() {
    if (selection || loading || !hasMore) return
    fetchPage(query.trim(), results.length, true)
  }

  function clear() {
    requestId.current += 1
    setQuery('')
    setResults([])
    setHasMore(false)
    setSearchError('')
    setActiveIndex(-1)
    setLoading(true)
    setOpen(true)
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
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
          onChange={(event) => {
            if (selection) onSelect(null)
            const nextQuery = event.target.value
            requestId.current += 1
            setQuery(nextQuery)
            setResults([])
            setHasMore(false)
            setSearchError('')
            setActiveIndex(-1)
            setLoading(true)
            setOpen(true)
          }}
          onFocus={openBrowseMenu}
          onClick={openBrowseMenu}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              requestId.current += 1
              setOpen(false)
              setActiveIndex(-1)
              setLoading(false)
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (!open) setOpen(true)
              if (results.length) {
                setActiveIndex((current) => Math.min(current + 1, results.length - 1))
              }
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (results.length) {
                setActiveIndex((current) => current <= 0 ? results.length - 1 : current - 1)
              }
              return
            }
            if (event.key === 'Enter' && open && activeIndex >= 0) {
              event.preventDefault()
              choose(results[activeIndex])
            }
          }}
        />
        {loading && <span className="autocomplete-loading">Loading drugs…</span>}
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
        <div
          id={listboxId}
          ref={menuRef}
          className="autocomplete-menu"
          role="listbox"
          aria-label={`${label} results`}
          onScroll={(event) => {
            const menu = event.currentTarget
            if (menu.scrollHeight - menu.scrollTop - menu.clientHeight < 80) loadMore()
          }}
        >
          {searchError ? (
            <div className="autocomplete-empty error" role="alert">
              {searchError}
            </div>
          ) : results.length ? (
            <>
              {results.map((item, index) => (
                <button
                  id={`${inputId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-option-index={index}
                  className={index === activeIndex ? 'active' : ''}
                  key={`${item.entity_id}-${item.node_id}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(item)}
                >
                  <span>{item.name}</span>
                  <small>{item.entity_id}</small>
                </button>
              ))}
              {loading && <div className="autocomplete-empty">Loading drugs…</div>}
            </>
          ) : (
            <div className="autocomplete-empty">
              {loading ? 'Loading drugs…' : 'No matching drugs found.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
