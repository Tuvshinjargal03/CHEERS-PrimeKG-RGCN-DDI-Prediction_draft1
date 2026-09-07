import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import InfoTooltip from '../components/InfoTooltip.jsx'
import RobustnessSection, { RobustnessLimitations } from '../components/RobustnessSection.jsx'

const GRAPH_LABELS = {
  G0: 'DDI only',
  G1: '+ Drug–Gene/Protein',
  G2: '+ Drug–Disease',
  G3: '+ Both',
}

function formatMetric(value, digits = 4) {
  return Number(value).toFixed(digits)
}

function scrollToExperimentSection(event, sectionId) {
  event.preventDefault()
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function MetricCard({ label, value, detail, tipText }) {
  return (
    <article className="metric-card">
      <span>
        {label}{' '}
        {tipText && (
          <InfoTooltip label={`Explain ${label}`} text={tipText} />
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
  const [classificationError, setClassificationError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      const [rankingResult, classificationResult] = await Promise.allSettled([
        fetch('/api/experiment').then((response) => {
          if (!response.ok) throw new Error('Ranking experiment data is unavailable.')
          return response.json()
        }),
        fetch('/api/classification').then((response) => {
          if (!response.ok) throw new Error('Classification metrics are unavailable.')
          return response.json()
        }),
      ])

      if (!active) return

      if (rankingResult.status === 'fulfilled') {
        setRanking(rankingResult.value)
      } else {
        setError(rankingResult.reason?.message || 'Experiment data could not be loaded.')
      }

      if (classificationResult.status === 'fulfilled') {
        setClassification(classificationResult.value)
      } else {
        setClassificationError(
          classificationResult.reason?.message || 'Classification metrics could not be loaded.',
        )
      }
      setLoading(false)
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
      MRRSD: results[graph].MRR.std,
      Hits1: results[graph]['Hits@1'].mean,
      Hits1SD: results[graph]['Hits@1'].std,
      Hits5: results[graph]['Hits@5'].mean,
      Hits5SD: results[graph]['Hits@5'].std,
      Hits10: results[graph]['Hits@10'].mean,
      Hits10SD: results[graph]['Hits@10'].std,
    }))
  }, [ranking])

  const classificationRows = useMemo(() => {
    const rows = classification?.summary?.summary
    if (!rows) return []

    return rows.map((row) => ({
      graph: row.Graph,
      Accuracy: row.Accuracy_mean,
      AccuracySD: row.Accuracy_std,
      Precision: row.Precision_mean,
      PrecisionSD: row.Precision_std,
      Recall: row.Recall_mean,
      RecallSD: row.Recall_std,
      F1: row.F1_mean,
      F1SD: row.F1_std,
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

  if (error || !ranking) {
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
    <section className="page experiments-page">
      <div className="page-heading">
        <span className="eyebrow">Evaluation</span>
        <h1>Experiments</h1>
        <p>
          Controlled five-seed comparison of G0–G3. MRR and Hits@K are the
          primary link-ranking metrics; Accuracy, Precision, Recall, and F1
          provide a complementary binary discrimination view.
        </p>
      </div>

      <nav className="experiment-section-nav" aria-label="Experiments sections">
        <a href="#experiment-overview" onClick={(event) => scrollToExperimentSection(event, 'experiment-overview')}>Overview</a>
        <a href="#experiment-ranking" onClick={(event) => scrollToExperimentSection(event, 'experiment-ranking')}>Ranking</a>
        <a href="#experiment-classification" onClick={(event) => scrollToExperimentSection(event, 'experiment-classification')}>Classification</a>
        <a href="#experiment-robustness" onClick={(event) => scrollToExperimentSection(event, 'experiment-robustness')}>Robustness</a>
      </nav>

      <section id="experiment-overview" className="experiment-major-section experiment-overview">
        <div className="experiments-section-heading">
          <span className="eyebrow">Primary results</span>
          <h2>G0–G3 five-seed evaluation</h2>
          <p>
            The controlled internal comparison and complementary classification
            results are the primary evidence for the graph-composition study.
          </p>
        </div>

        <div className="experiment-highlight">
          <div>
            <span className="card-kicker">Primary finding</span>
            <h2>G3 provides the strongest overall performance</h2>
            <p>
              The full heterogeneous graph combines DDI, Drug–Gene/Protein, and
              Drug–Disease information while keeping the model and DDI split fixed.
            </p>
          </div>
          <div className="highlight-badge">
            <CheckCircle2 size={22} />
            <strong>5 / 5</strong>
            <span>paired seeds</span>
            <small>
              positive G3−G0 deltas on all ranking metrics{' '}
              <InfoTooltip
                label="Explain the five-of-five result"
                text="G3’s MRR is higher than the paired G0 result for each of the five reported training seeds. This describes seed consistency and is not a general proof of statistical significance."
              />
            </small>
          </div>
        </div>

        <div className="experiment-inline-heading">
          <span className="eyebrow">At a glance</span>
          <h3>Headline metrics</h3>
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
          {g3Class && (
            <>
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
            </>
          )}
        </div>
      </section>

      <section id="experiment-ranking" className="experiment-major-section">
        <div className="experiments-section-heading">
          <span className="eyebrow">Primary evaluation</span>
          <h2>
            Link-ranking performance{' '}
            <InfoTooltip
              label="Explain Hits at K"
              text="Hits@K is the fraction of ranking queries where the correct held-out drug appears within the top K candidates."
            />
          </h2>
          <p>MRR and Hits@K are the primary link-ranking metrics.</p>
        </div>
        <article className="chart-card">
          <div className="chart-heading chart-heading--compact">
            <span className="chart-note">Full 0–1 scale · mean ± SD</span>
          </div>

          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankingRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="graph" />
                <YAxis domain={[0, 1]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="MRR" fill="#6941c6" radius={[4, 4, 0, 0]}><ErrorBar dataKey="MRRSD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
                <Bar dataKey="Hits1" name="Hits@1" fill="#7f56d9" radius={[4, 4, 0, 0]}><ErrorBar dataKey="Hits1SD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
                <Bar dataKey="Hits5" name="Hits@5" fill="#9e77ed" radius={[4, 4, 0, 0]}><ErrorBar dataKey="Hits5SD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
                <Bar dataKey="Hits10" name="Hits@10" fill="#b692f6" radius={[4, 4, 0, 0]}><ErrorBar dataKey="Hits10SD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p><small>Bars use the full 0–1 metric scale. Error bars show ±1 SD across five training seeds for the fixed evaluation split.</small></p>
        </article>
      </section>

      <section id="experiment-classification" className="experiment-major-section">
        <div className="experiments-section-heading">
          <span className="eyebrow">Complementary evaluation</span>
          <h2>
            Binary discrimination metrics{' '}
            <InfoTooltip
              label="Explain complementary classification"
              text="Accuracy, Precision, Recall, and F1 provide a complementary balanced binary evaluation using thresholds selected on validation data."
            />
          </h2>
          <p>Accuracy, Precision, Recall, and F1 provide a complementary binary discrimination view.</p>
        </div>
        {classification ? (
          <article className="chart-card">
            <div className="chart-heading chart-heading--compact">
              <span className="chart-note">Full 0–1 scale · mean ± SD</span>
            </div>

            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={classificationRows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="graph" />
                  <YAxis domain={[0, 1]} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Accuracy" fill="#1570ef" radius={[4, 4, 0, 0]}><ErrorBar dataKey="AccuracySD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
                  <Bar dataKey="Precision" fill="#2e90fa" radius={[4, 4, 0, 0]}><ErrorBar dataKey="PrecisionSD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
                  <Bar dataKey="Recall" fill="#53b1fd" radius={[4, 4, 0, 0]}><ErrorBar dataKey="RecallSD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
                  <Bar dataKey="F1" fill="#84caff" radius={[4, 4, 0, 0]}><ErrorBar dataKey="F1SD" direction="y" width={4} stroke="#667085" strokeWidth={1} /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p><small>Bars use the full 0–1 metric scale. Error bars show ±1 SD across five training seeds for the fixed evaluation split.</small></p>
          </article>
        ) : (
          <article className="chart-card">
            <div className="inline-alert error"><AlertCircle size={20} />{classificationError || 'Classification metrics are unavailable.'} Primary ranking results remain available.</div>
          </article>
        )}
      </section>

      <section className="section-block experiment-major-section experiment-details">
        <div className="section-title">
          <div>
            <span className="eyebrow">Graph comparison</span>
            <h2>
              Five-seed mean results{' '}
              <InfoTooltip
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
                {classification && <><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th></>}
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
                    {cls && <><td>{formatMetric(cls.Accuracy)}</td><td>{formatMetric(cls.Precision)}</td><td>{formatMetric(cls.Recall)}</td><td>{formatMetric(cls.F1)}</td></>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="experiment-robustness" className="experiment-major-section experiment-robustness">
        <RobustnessSection />
      </section>

      <section className="experiment-major-section experiment-interpretation">
        <div className="experiments-section-heading">
          <span className="eyebrow">Interpretation &amp; limitations</span>
          <h2>Evaluation notes and scientific boundaries</h2>
        </div>
        <div className="experiment-limitations-layout">
          <section className="experiment-limitations-group">
            <h3>Scientific boundaries</h3>
            <RobustnessLimitations />
          </section>
          <section className="experiment-limitations-group">
            <h3>Evaluation protocol notes</h3>
            <div className="experiment-notes">
              {classification && <><article><strong>Ranking remains primary.</strong><p>{classification.interpretation}</p></article><article><strong>Negative-class definition.</strong><p>{classification.negative_class_note}</p></article><article><strong>Threshold selection.</strong><p>{classification.threshold_note}</p></article></>}
              <article>
                <strong>Reporting caveat.</strong>
                <p>{ranking.reporting_note}</p>
              </article>
            </div>
          </section>
        </div>
      </section>
    </section>
  )
}

export default Experiments
