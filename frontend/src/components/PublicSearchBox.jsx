import { Search } from 'lucide-react'
import { useId, useState } from 'react'

export default function PublicSearchBox({
  initialValue = '',
  onSearch,
  label = 'Search medicines and diseases',
  placeholder = 'Search a medicine, disease, or medicine pair…',
  autoFocus = false,
}) {
  const inputId = useId()
  const [value, setValue] = useState(initialValue)

  function submit(event) {
    event.preventDefault()
    const query = value.trim()
    if (query) onSearch(query)
  }

  return (
    <form className="public-search-form" role="search" onSubmit={submit}>
      <label htmlFor={inputId}>{label}</label>
      <div className="public-search-control">
        <Search size={21} aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        <button type="submit" className="primary-button" disabled={!value.trim()}>
          Search
        </button>
      </div>
    </form>
  )
}
