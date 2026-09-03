import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'

function UniqueBulbBadge({ text, label = 'View helper note' }) {
  const [isHovered, setIsHovered] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const isOpen = isHovered || isPinned

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 5,
        verticalAlign: 'middle',
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => setIsPinned((current) => !current)}
        style={{
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          padding: '0 2px',
          display: 'inline-flex',
          lineHeight: 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: 12,
            filter: isOpen
              ? 'drop-shadow(0 0 6px #f59e0b)'
              : 'drop-shadow(0 0 3px rgba(245, 158, 11, 0.7))',
          }}
        >
          💡
        </span>
      </button>
      {isOpen && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(260px, calc(100vw - 48px))',
            padding: '10px 14px',
            background: 'rgba(26, 32, 44, 0.96)',
            color: '#f7fafc',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.55,
            whiteSpace: 'normal',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            zIndex: 9999,
            pointerEvents: 'none',
            textAlign: 'left',
            border: '1px solid rgba(255, 255, 255, 0.12)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

const GRAPH_LABELS = {
  G0: 'DDI only',
  G1: '+ Drug–Gene/Protein',
  G2: '+ Drug–Disease',
  G3: '+ Both',
}

function formatMetric(value, digits = 4) {
  return Number(value).toFixed(digits)
}

function MetricCard({ label, value, detail, tipText }) {
  return (
    <article className="metric-card">
      <span>
        {label}{' '}
        {tipText && (
          <UniqueBulbBadge label={`Explain ${label}`} text={tipText} />
        )}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function Experiments() {
  const [ranking, setRanking] = useState(null)
  const [classification, setClassification] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const [rankingResponse, classificationResponse] = await Promise.all([
          fetch('/api/experiment'),
          fetch('/api/classification'),
        ])

        if (!rankingResponse.ok || !classificationResponse.ok) {
          throw new Error('Experiment endpoints are unavailable.')
        }

        const [rankingData, classificationData] = await Promise.all([
          rankingResponse.json(),
          classificationResponse.json(),
        ])

        if (!active) return

        setRanking(rankingData)
        setClassification(classificationData)
      } catch (err) {
        if (active) setError(err.message || 'Experiment data could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [])

  const rankingRows = useMemo(() => {
    const results = ranking?.summary?.final_results_mean_std
    if (!results) return []

    return ['G0', 'G1', 'G2', 'G3'].map((graph) => ({
      graph,
      MRR: results[graph].MRR.mean,
      Hits1: results[graph]['Hits@1'].mean,
      Hits5: results[graph]['Hits@5'].mean,
      Hits10: results[graph]['Hits@10'].mean,
    }))
  }, [ranking])

  const classificationRows = useMemo(() => {
    const rows = classification?.summary?.summary
    if (!rows) return []

    return rows.map((row) => ({
      graph: row.Graph,
      Accuracy: row.Accuracy_mean,
      Precision: row.Precision_mean,
      Recall: row.Recall_mean,
      F1: row.F1_mean,
    }))
  }, [classification])

  if (loading) {
    return (
      <section className="page">
        <div className="page-heading">
          <span className="eyebrow">Evaluation</span>
          <h1>Experiments</h1>
        </div>
        <div className="experiment-state">
          <LoaderCircle className="spin" size={28} />
          <span>Loading verified experiment results...</span>
        </div>
      </section>
    )
  }

  if (error || !ranking || !classification) {
    return (
      <section className="page">
        <div className="page-heading">
          <span className="eyebrow">Evaluation</span>
          <h1>Experiments</h1>
        </div>
        <div className="experiment-state error">
          <AlertCircle size={28} />
          <span>{error || 'Experiment data is unavailable.'}</span>
        </div>
      </section>
    )
  }

  const primary = ranking.summary.primary_result
  const g3Class = classificationRows.find((row) => row.graph === 'G3')

  return (
    <section className="page">
      <div className="page-heading">
        <span className="eyebrow">Evaluation</span>
        <h1>
          Experiments{' '}
          <UniqueBulbBadge
            label="Explain the controlled experiments"
            text="Controlled comparison of G0–G3 using the same DDI split, model architecture, decoder, and evaluation protocol across five training seeds."
          />
        </h1>
        <p>
          Controlled five-seed comparison of G0–G3. MRR and Hits@K are the
          primary link-ranking metrics; Accuracy, Precision, Recall, and F1
          provide a complementary binary discrimination view.
        </p>
      </div>

      <div className="experiment-highlight">
        <div>
          <span className="card-kicker">Primary finding</span>
          <h2>
            G3 provides the strongest overall performance{' '}
            <UniqueBulbBadge
              label="Explain the primary G3 finding"
              text="G3 has the strongest overall five-seed mean across the reported graph-composition metrics and beats G0 in MRR in all five paired seeds."
            />
          </h2>
          <p>
            The full heterogeneous graph combines DDI, Drug–Gene/Protein, and
            Drug–Disease information while keeping the model and DDI split fixed.
          </p>
        </div>
        <div className="highlight-badge">
          <CheckCircle2 size={22} />
          <strong>5 / 5</strong>
          <span>
            seeds beat G0{' '}
            <UniqueBulbBadge
              label="Explain the five-of-five result"
              text="G3’s MRR is higher than the paired G0 result for each of the five reported training seeds. This describes seed consistency and is not a general proof of statistical significance."
            />
          </span>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard
          label="G3 MRR"
          value={formatMetric(primary.mean_MRR)}
          detail={`± ${formatMetric(primary.MRR_std)}`}
          tipText="Mean Reciprocal Rank summarizes how highly the correct held-out interaction partner is ranked. Higher values are better."
        />
        <MetricCard
          label="MRR gain vs G0"
          value={`+${formatMetric(primary.absolute_MRR_improvement_vs_G0)}`}
          detail={`${primary.relative_MRR_improvement_percent}% relative`}
          tipText="Difference between the five-seed mean MRR of G3 and G0 under the controlled graph-composition experiment."
        />
        <MetricCard
          label="G3 Accuracy"
          value={formatMetric(g3Class.Accuracy)}
          detail="five-seed mean"
          tipText="Fraction of examples correctly classified in the complementary balanced binary evaluation using a validation-selected threshold."
        />
        <MetricCard
          label="G3 F1"
          value={formatMetric(g3Class.F1)}
          detail="five-seed mean"
          tipText="Harmonic mean of precision and recall in the complementary binary evaluation."
        />
      </div>

      <div className="experiment-grid">
        <article className="chart-card">
          <div className="chart-heading">
            <div>
              <span className="eyebrow">Primary evaluation</span>
              <h2>
                Link-ranking performance{' '}
                <UniqueBulbBadge
                  label="Explain Hits at K"
                  text="Hits@K is the fraction of ranking queries where the correct held-out drug appears within the top K candidates."
                />
              </h2>
            </div>
            <span className="chart-note">5-seed mean</span>
          </div>

          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankingRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="graph" />
                <YAxis domain={[0.45, 0.64]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="MRR" fill="#6941c6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Hits1" name="Hits@1" fill="#7f56d9" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Hits5" name="Hits@5" fill="#9e77ed" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Hits10" name="Hits@10" fill="#b692f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="chart-card">
          <div className="chart-heading">
            <div>
              <span className="eyebrow">Complementary evaluation</span>
              <h2>
                Binary discrimination metrics{' '}
                <UniqueBulbBadge
                  label="Explain complementary classification"
                  text="Accuracy, Precision, Recall, and F1 provide a complementary balanced binary evaluation using thresholds selected on validation data."
                />
              </h2>
            </div>
            <span className="chart-note">balanced test set</span>
          </div>

          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={classificationRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="graph" />
                <YAxis domain={[0.88, 0.95]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Accuracy" fill="#1570ef" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Precision" fill="#2e90fa" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Recall" fill="#53b1fd" radius={[4, 4, 0, 0]} />
                <Bar dataKey="F1" fill="#84caff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>

      <div className="section-block">
        <div className="section-title">
          <div>
            <span className="eyebrow">Graph comparison</span>
            <h2>
              Five-seed mean results{' '}
              <UniqueBulbBadge
                label="Explain the five-seed mean"
                text="Results are averaged across training seeds 42–46. This captures training-seed variation for one fixed split."
              />
            </h2>
          </div>
        </div>

        <div className="results-table-wrap">
          <table className="results-table">
            <thead>
              <tr>
                <th>Graph</th>
                <th>Composition</th>
                <th>MRR</th>
                <th>Hits@1</th>
                <th>Hits@5</th>
                <th>Hits@10</th>
                <th>Accuracy</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F1</th>
              </tr>
            </thead>
            <tbody>
              {rankingRows.map((row) => {
                const cls = classificationRows.find(
                  (item) => item.graph === row.graph,
                )

                return (
                  <tr key={row.graph} className={row.graph === 'G3' ? 'best-row' : ''}>
                    <td><strong>{row.graph}</strong></td>
                    <td>{GRAPH_LABELS[row.graph]}</td>
                    <td>{formatMetric(row.MRR)}</td>
                    <td>{formatMetric(row.Hits1)}</td>
                    <td>{formatMetric(row.Hits5)}</td>
                    <td>{formatMetric(row.Hits10)}</td>
                    <td>{formatMetric(cls.Accuracy)}</td>
                    <td>{formatMetric(cls.Precision)}</td>
                    <td>{formatMetric(cls.Recall)}</td>
                    <td>{formatMetric(cls.F1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="experiment-notes">
        <article>
          <strong>Ranking remains primary.</strong>
          <p>{classification.interpretation}</p>
        </article>
        <article>
          <strong>Negative-class definition.</strong>
          <p>{classification.negative_class_note}</p>
        </article>
        <article>
          <strong>Threshold selection.</strong>
          <p>{classification.threshold_note}</p>
        </article>
        <article>
          <strong>Reporting caveat.</strong>
          <p>{ranking.reporting_note}</p>
        </article>
      </div>
    </section>
  )
}

export default Experiments
