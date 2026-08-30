import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getJson } from '../lib/api.js'

const FAMILY_COLORS = {
  'Drug-Gene/Protein': '#6941c6',
  'Drug-Disease': '#1570ef',
}

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
      .then((payload) => {
        if (active) setData(payload)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Relation results could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const chartRows = useMemo(
    () =>
      (data?.results || []).map((row) => ({
        relation: row.relation,
        delta: row.delta_mrr_mean,
        family: row.family,
      })),
    [data],
  )
  const mostConsistent = useMemo(
    () =>
      (data?.results || [])
        .filter((row) => row.wins_vs_g0 === 3)
        .reduce(
          (best, row) => (!best || row.delta_mrr_mean > best.delta_mrr_mean ? row : best),
          null,
        ),
    [data],
  )
  const highestHits1 = useMemo(
    () =>
      (data?.results || []).reduce(
        (best, row) => (!best || row.hits1_mean > best.hits1_mean ? row : best),
        null,
      ),
    [data],
  )
  const mostConsistentHasFewestEdges = useMemo(() => {
    if (!mostConsistent || !data?.results?.length) return false
    return data.results.every(
      (row) => row.graph === mostConsistent.graph || mostConsistent.biomedical_edges < row.biomedical_edges,
    )
  }, [data, mostConsistent])

  return (
    <section className="page">
      <div className="page-heading">
        <span className="eyebrow">Secondary follow-up analysis</span>
        <h1>Relation Analysis</h1>
        <p>
          Each three-seed variant keeps the G0 DDI-only backbone and adds one
          biomedical relation plus its reverse edges. Paired ΔMRR shows the
          change relative to the matching G0 seed.
        </p>
      </div>

      {loading && (
        <div className="experiment-state"><LoaderCircle className="spin" size={26} /> Loading frozen relation results…</div>
      )}
      {error && (
        <div className="experiment-state error"><AlertCircle size={26} /> {error}</div>
      )}

      {data && (
        <>
          <div className="analysis-summary-grid">
            <article className="summary-card accent-card">
              <span className="card-kicker">Highest mean contribution</span>
              <strong>{data.results[0].relation}</strong>
              <p>{signed(data.results[0].delta_mrr_mean)} mean ΔMRR vs G0</p>
            </article>
            <article className="summary-card">
              <span>Most consistent strong performer</span>
              <strong>{mostConsistent?.relation || 'Not available'}</strong>
              <p>{mostConsistent ? `Positive in all three matched seeds with ${signed(mostConsistent.delta_mrr_mean)} mean ΔMRR vs G0.` : 'No relation improved across all three matched seeds.'}</p>
            </article>
            <article className="summary-card">
              <span>Three-seed G0 baseline</span>
              <strong>{data.baseline.mrr_mean.toFixed(6)}</strong>
              <p>MRR ± {data.baseline.mrr_std.toFixed(6)}</p>
            </article>
          </div>

          <div className="analysis-grid">
            <article className="chart-card relation-chart-card">
              <div className="chart-heading">
                <div><span className="eyebrow">Paired contribution</span><h2>Mean ΔMRR relative to G0</h2></div>
                <span className="chart-note">3-seed mean</span>
              </div>
              <div className="relation-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows} layout="vertical" margin={{ left: 14, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(value) => signed(value, 3)} />
                    <YAxis type="category" dataKey="relation" width={112} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => [signed(value), 'Mean ΔMRR']} />
                    <ReferenceLine x={0} stroke="#667085" />
                    <Bar dataKey="delta" radius={[0, 4, 4, 0]}>
                      {chartRows.map((row) => (
                        <Cell key={row.relation} fill={FAMILY_COLORS[row.family]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="relation-legend">
                {Object.entries(FAMILY_COLORS).map(([family, color]) => (
                  <span key={family}><i style={{ background: color }} />{family}</span>
                ))}
              </div>
            </article>

            <article className="interpretation-card">
              <span className="eyebrow">Scientific interpretation</span>
              <h2>Observed ranking contribution varies by relation semantics</h2>
              <ul>
                <li><strong>Indication</strong> has the highest mean MRR, Hits@5, and Hits@10, but improves in MRR over G0 in only two of three seeds.</li>
                {mostConsistent && <li><strong>{mostConsistent.relation}</strong> is nearly tied in mean MRR and positive in every matched seed{mostConsistentHasFewestEdges ? ' despite having the fewest biomedical edges.' : '.'}{highestHits1?.graph === mostConsistent.graph ? ' It also has the highest mean Hits@1.' : ''}</li>}
                <li><strong>Transporter</strong> also improves all three matched seeds with a smaller mean gain.</li>
                <li><strong>Off-label use</strong> is unstable; one poor seed drives its negative mean.</li>
              </ul>
              <div className="caveat-box">{data.caveat}</div>
            </article>
          </div>

          <div className="section-block">
            <div className="section-title">
              <div><span className="eyebrow">Ranked results</span><h2>Individual relation contribution</h2></div>
            </div>
            <div className="results-table-wrap">
              <table className="results-table relation-table">
                <thead><tr><th>Rank</th><th>Relation</th><th>Family</th><th>MRR mean ± SD</th><th>Hits@1 mean ± SD</th><th>Hits@5 mean ± SD</th><th>Hits@10 mean ± SD</th><th>Mean ΔMRR ± SD</th><th>Wins vs G0</th><th>Edges</th></tr></thead>
                <tbody>
                  {data.results.map((row) => (
                    <tr key={row.graph}>
                      <td><strong>#{row.rank}</strong></td>
                      <td>{row.relation}</td>
                      <td><span className={`family-pill ${row.family === 'Drug-Disease' ? 'disease' : ''}`}>{row.family}</span></td>
                      <td>{row.mrr_mean.toFixed(6)} ± {row.mrr_std.toFixed(6)}</td>
                      <td>{row.hits1_mean.toFixed(6)} ± {row.hits1_std.toFixed(6)}</td>
                      <td>{row.hits5_mean.toFixed(6)} ± {row.hits5_std.toFixed(6)}</td>
                      <td>{row.hits10_mean.toFixed(6)} ± {row.hits10_std.toFixed(6)}</td>
                      <td className={row.delta_mrr_mean >= 0 ? 'positive-value' : 'negative-value'}>{signed(row.delta_mrr_mean)} ± {row.delta_mrr_std.toFixed(6)}</td>
                      <td><span className="wins-cell"><CheckCircle2 size={15} />{row.wins_vs_g0}/3</span></td>
                      <td>{row.biomedical_edges.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
