import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getJson } from '../lib/api.js'

const FAMILY_COLORS = { 'Drug-Gene/Protein': '#6941c6', 'Drug-Disease': '#1570ef' }

function signed(value, digits = 6) {
  const number = Number(value)
  return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}`
}

export default function RelationAnalysis() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getJson('/api/relation-analysis')
      .then((payload) => { if (active) setData(payload) })
      .catch((requestError) => { if (active) setError(requestError.message || 'Relation results could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const chartRows = useMemo(() => (data?.results || []).map((row) => ({
    relation: row.relation,
    delta: row.delta_mrr_mean,
    error: [row.delta_mrr_mean - row.ci95_low, row.ci95_high - row.delta_mrr_mean],
    family: row.family,
  })), [data])

  return (
    <section className="page">
      <div className="page-heading">
        <span className="eyebrow">Verified five-seed follow-up · v1</span>
        <h1>Relation Analysis</h1>
        <p>Each variant keeps the G0 DDI-only backbone and adds one biomedical relation plus its reverse edges. Paired ΔMRR compares every run with the matching G0 training seed on the same fixed split.</p>
      </div>

      {loading && <div className="experiment-state"><LoaderCircle className="spin" size={26} /> Loading verified relation results…</div>}
      {error && <div className="experiment-state error"><AlertCircle size={26} /> {error}</div>}

      {data && <>
        <div className="analysis-summary-grid">
          <article className="summary-card accent-card"><span className="card-kicker">Largest descriptive mean improvement</span><strong>{data.results[0].relation}</strong><p>{signed(data.results[0].delta_mrr_mean)} mean ΔMRR; {data.results[0].wins_vs_g0}/5 wins</p></article>
          <article className="summary-card"><span>Verified study coverage</span><strong>{data.relation_runs} relation runs</strong><p>7 relations × 5 seeds, paired with {data.paired_baseline_runs} G0 runs</p></article>
          <article className="summary-card"><span>Five-seed G0 baseline</span><strong>{data.baseline.mrr_mean.toFixed(6)}</strong><p>MRR ± {data.baseline.mrr_std.toFixed(6)} SD</p></article>
        </div>

        <div className="analysis-grid">
          <article className="chart-card relation-chart-card">
            <div className="chart-heading"><div><span className="eyebrow">Paired ranking result</span><h2>Mean ΔMRR relative to G0</h2></div><span className="chart-note">Pointwise 95% paired t intervals</span></div>
            <div className="relation-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} layout="vertical" margin={{ left: 14, right: 36 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[-0.045, 0.02]} tickFormatter={(value) => signed(value, 3)} /><YAxis type="category" dataKey="relation" width={112} tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => [signed(value), 'Mean ΔMRR']} /><ReferenceLine x={0} stroke="#667085" strokeDasharray="4 3" /><Bar dataKey="delta" radius={[0, 4, 4, 0]}><ErrorBar dataKey="error" width={5} strokeWidth={1.5} stroke="#344054" direction="x" />{chartRows.map((row) => <Cell key={row.relation} fill={FAMILY_COLORS[row.family]} />)}</Bar></BarChart></ResponsiveContainer></div>
            <div className="relation-legend">{Object.entries(FAMILY_COLORS).map(([family, color]) => <span key={family}><i style={{ background: color }} />{family}</span>)}</div>
          </article>

          <article className="interpretation-card">
            <span className="eyebrow">Scientific interpretation</span><h2>Descriptive effects vary by relation and seed</h2>
            <ul><li><strong>Target</strong> has the largest mean improvement and wins in four of five paired seeds.</li><li>Carrier, indication, and transporter have smaller positive means; enzyme, contraindication, and off-label use have unfavorable means.</li><li>Every 95% paired interval includes zero, so no relation has an established improvement.</li><li>The off-label result retains the unfavorable seed 44 run rather than selectively excluding it.</li></ul>
            <div className="caveat-box">{data.caveat}</div>
          </article>
        </div>

        <div className="section-block">
          <div className="section-title"><div><span className="eyebrow">All outcomes retained</span><h2>Five-seed relation results</h2></div></div>
          <div className="results-table-wrap"><table className="results-table relation-table"><thead><tr><th>Rank</th><th>Relation</th><th>Family</th><th>MRR mean ± SD</th><th>Mean ΔMRR ± SD</th><th>95% paired interval</th><th>Wins vs G0</th><th>Edges</th></tr></thead><tbody>{data.results.map((row) => <tr key={row.graph}><td><strong>#{row.rank}</strong></td><td>{row.relation}</td><td><span className={`family-pill ${row.family === 'Drug-Disease' ? 'disease' : ''}`}>{row.family}</span></td><td>{row.mrr_mean.toFixed(6)} ± {row.mrr_std.toFixed(6)}</td><td className={row.delta_mrr_mean >= 0 ? 'positive-value' : 'negative-value'}>{signed(row.delta_mrr_mean)} ± {row.delta_mrr_std.toFixed(6)}</td><td>[{signed(row.ci95_low)}, {signed(row.ci95_high)}]</td><td><span className="wins-cell"><CheckCircle2 size={15} />{row.wins_vs_g0}/5</span></td><td>{row.biomedical_edges.toLocaleString()}</td></tr>)}</tbody></table></div>
        </div>

        <div className="section-block">
          <div className="section-title"><div><span className="eyebrow">Matched runs</span><h2>Per-seed paired ΔMRR</h2></div></div>
          <div className="results-table-wrap"><table className="results-table relation-table"><thead><tr><th>Relation</th>{data.seeds.map((seed) => <th key={seed}>Seed {seed}</th>)}</tr></thead><tbody>{data.results.map((row) => <tr key={row.graph}><td>{row.relation}</td>{row.seed_deltas.map((item) => <td key={item.seed} className={item.delta_mrr >= 0 ? 'positive-value' : 'negative-value'}>{signed(item.delta_mrr)}</td>)}</tr>)}</tbody></table></div>
        </div>

        <aside className="limitations-card"><AlertCircle size={21} /><div><strong>Coverage and implementation lineage</strong><ul><li>{data.classification_note}</li><li>{data.implementation_lineage}</li></ul></div></aside>

        <details className="section-block"><summary><strong>{data.history.label}</strong> (seeds {data.history.seeds.join(', ')})</summary><p>This earlier three-seed ranking result is preserved as history. Its ordering changed after adding seeds 45 and 46; it is not the current study estimate.</p><div className="results-table-wrap"><table className="results-table"><thead><tr><th>Relation</th><th>Mean MRR</th><th>Mean ΔMRR</th><th>Wins</th></tr></thead><tbody>{data.history.results.map((row) => <tr key={row.graph}><td>{row.relation}</td><td>{row.mrr_mean.toFixed(6)}</td><td>{signed(row.delta_mrr_mean)}</td><td>{row.wins_vs_g0}/3</td></tr>)}</tbody></table></div></details>
      </>}
    </section>
  )
}
