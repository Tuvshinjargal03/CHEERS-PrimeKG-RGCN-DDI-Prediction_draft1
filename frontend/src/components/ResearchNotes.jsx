export default function ResearchNotes({ summary, children, id, className = '' }) {
  return (
    <details id={id} className={`research-notes ${className}`.trim()}>
      <summary><span>Interpretation notes</span><small>{summary}</small></summary>
      <div className="research-notes-content">{children}</div>
    </details>
  )
}
