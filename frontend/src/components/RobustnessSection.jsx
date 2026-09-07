import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { robustnessResults } from '../data/robustnessResults.js'
import InfoTooltip from './InfoTooltip.jsx'
import './RobustnessSection.css'

const EXTERNAL_BAR_COLORS = {
  G0: '#98a2b3',
  G3: '#6941c6',
  'Structural-only': '#f79009',
  Hybrid: '#7f56d9',
}

function fixed(value, digits = 6) {
  return Number(value).toFixed(digits)
}

function EvidenceBadge({ level, tone }) {
  return <span className={`robustness-evidence-badge robustness-evidence-badge--${tone}`}>{level}</span>
}

function RobustnessLimitations() {
  return (
    <aside className="robustness-limitations">
      <AlertTriangle size={22} aria-hidden="true" />
      <ul>
        <li>Primary G0/G3 values are five-seed means on one fixed internal split.</li>
        <li>DDInter and representation comparisons are exploratory seed-44 results.</li>
        <li>Cold-start uses three model seeds conditional on one fixed cold cohort.</li>
        <li>DDI-edge cold-start is not a fully inductive unseen-node evaluation.</li>
        <li>No result is clinical validation, and raw scores are not probabilities or clinical risk.</li>
        <li>Observed differences do not establish causal mechanisms.</li>
      </ul>
    </aside>
  )
}

function RobustnessSection() {
  const {
    evidenceLevels,
    primaryInternal,
    externalDdinter,
    representationDiagnostic,
    coldStart,
    relationAnalysis,
  } = robustnessResults
  const primaryByModel = Object.fromEntries(
    primaryInternal.models.map((model) => [model.model, model]),
  )

  return (
    <section className="robustness-section" aria-labelledby="robustness-heading">
      <header className="robustness-heading">
        <span className="eyebrow">Follow-up diagnostics</span>
        <h2 id="robustness-heading">Robustness &amp; Generalization</h2>
        <p>
          These follow-up experiments examine behavior beyond the primary fixed-split
          PrimeKG comparison. Their study designs and evidence levels differ, so they
          should not be interpreted as a single model leaderboard.
        </p>
        <div className="robustness-evidence-guide" aria-label="Evidence levels used in this section">
          <EvidenceBadge level={evidenceLevels.primary} tone="primary" />
          <EvidenceBadge level={evidenceLevels.exploratory} tone="exploratory" />
          <EvidenceBadge level={evidenceLevels.robustness} tone="robustness" />
        </div>
      </header>

      <article className="robustness-primary-anchor">
        <div className="robustness-panel-heading">
          <div>
            <EvidenceBadge level={evidenceLevels.primary} tone="primary" />
            <h3>Primary result reference</h3>
          </div>
          <span>{primaryInternal.scope}</span>
        </div>
        <p>
          G3 achieved the strongest overall five-seed mean internal performance,
          although its gains over G0 were modest.
        </p>
        <div className="robustness-primary-metrics">
          <div><span>G0 MRR</span><strong>{fixed(primaryByModel.G0.MRR)}</strong><small>± {fixed(primaryByModel.G0.MRRSD)}</small></div>
          <div><span>G3 MRR</span><strong>{fixed(primaryByModel.G3.MRR)}</strong><small>± {fixed(primaryByModel.G3.MRRSD)}</small></div>
          <div><span>Mean difference</span><strong>+{fixed(primaryInternal.mrrDifference)}</strong><small>G3 − G0</small></div>
        </div>
      </article>

      <article className="robustness-panel robustness-panel--exploratory">
        <div className="robustness-panel-heading">
          <div>
            <EvidenceBadge level={evidenceLevels.exploratory} tone="exploratory" />
            <h3>
              External DDInter diagnostic{' '}
              <InfoTooltip
                label="Explain the external DDInter diagnostic"
                text="Single-seed exploratory evaluation; not clinical validation. Raw model outputs are ranking scores, not probabilities, confidence measures, or clinical-risk estimates."
              />
            </h3>
          </div>
          <span>{externalDdinter.scope}</span>
        </div>

        <div className="robustness-external-grid">
          <div>
            <h4>Observed DDInter MRR</h4>
            <div
              className="robustness-chart"
              role="img"
              aria-label="Horizontal bar chart comparing seed 44 DDInter MRR for G0, G3, Structural-only, and Hybrid models"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={externalDdinter.models}
                  layout="vertical"
                  margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 0.018]} tickFormatter={(value) => Number(value).toFixed(3)} />
                  <YAxis type="category" dataKey="model" width={105} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => [fixed(value, 7), 'MRR']} />
                  <Bar dataKey="MRR" radius={[0, 4, 4, 0]}>
                    {externalDdinter.models.map((row) => (
                      <Cell key={row.model} fill={EXTERNAL_BAR_COLORS[row.model]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="robustness-interpretation">
            <h4>Observed transfer pattern</h4>
            <p>
              Structural-only has the highest observed DDInter MRR in this seed-44
              comparison despite substantially lower internal PrimeKG performance.
              Hybrid preserves strong internal performance but does not retain the
              structural-only external-transfer advantage.
            </p>
            <p>
              This suggests a possible internal transductive-performance versus
              external-transfer trade-off that requires additional seeds and datasets.
            </p>
          </div>
        </div>

        <div className="robustness-table-wrap">
          <table className="robustness-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>MRR</th>
                <th>H@1</th>
                <th>H@5</th>
                <th>H@10</th>
                <th>Mean rank</th>
                <th>Median rank</th>
              </tr>
            </thead>
            <tbody>
              {externalDdinter.models.map((row) => (
                <tr key={row.model}>
                  <td><strong>{row.model}</strong></td>
                  <td>{fixed(row.MRR, 7)}</td>
                  <td>{fixed(row.Hits1, 7)}</td>
                  <td>{fixed(row.Hits5, 7)}</td>
                  <td>{fixed(row.Hits10, 7)}</td>
                  <td>{row.meanRank.toFixed(1)}</td>
                  <td>{row.medianRank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="robustness-study-limit">
          Single-seed exploratory evaluation; not clinical validation. Raw model
          outputs are ranking scores, not probabilities, confidence measures, or
          clinical-risk estimates.
        </p>
      </article>

      <div className="robustness-subsection-heading">
        <span className="eyebrow">Representation diagnostic</span>
        <h3>Internal performance and external transfer</h3>
      </div>
      <div className="robustness-representation-grid">
        {representationDiagnostic.map((row) => (
          <article className="robustness-representation-card" key={row.model}>
            <EvidenceBadge level={evidenceLevels.exploratory} tone="exploratory" />
            <h4>{row.model}</h4>
            <dl>
              <div><dt>PrimeKG internal MRR</dt><dd>{fixed(row.internal.MRR)}</dd></div>
              <div><dt>DDInter MRR</dt><dd>{fixed(row.externalMRR, 7)}</dd></div>
            </dl>
            <p>{row.summary}</p>
          </article>
        ))}
      </div>

      <article className="robustness-panel robustness-panel--cold-start">
        <div className="robustness-panel-heading">
          <div>
            <EvidenceBadge level={evidenceLevels.robustness} tone="robustness" />
            <h3>
              DDI-edge cold-start{' '}
              <InfoTooltip
                label="Explain DDI-edge cold-start"
                text="This is not a fully inductive unseen-drug evaluation. Cold drugs remain represented graph nodes, and the result does not establish a causal mechanism."
              />
            </h3>
          </div>
          <span>{coldStart.scope}</span>
        </div>
        <div className="robustness-cold-grid">
          {coldStart.models.map((row) => (
            <div className="robustness-cold-metric" key={row.model}>
              <span>{row.model} MRR</span>
              <strong>{fixed(row.MRR)}</strong>
              <small>± {fixed(row.MRRSD)}</small>
            </div>
          ))}
          <div className="robustness-cold-interpretation">
            <p><strong>G0 substantially outperformed G3 across all three model seeds in this DDI-edge cold-start setting.</strong></p>
            <p>This is not a fully inductive unseen-drug evaluation. Cold drugs remain represented graph nodes, and the result does not establish a causal mechanism.</p>
          </div>
        </div>
      </article>

      <article className="robustness-relation-card">
        <div>
          <span className="eyebrow">Related five-seed analysis</span>
          <h3>Relation-level descriptive trends</h3>
          <p>
            Largest descriptive relation trend: {relationAnalysis.relation} addition,
            mean ΔMRR +{fixed(relationAnalysis.meanDeltaMRR)} over G0. Every pointwise
            95% paired interval includes zero, so no relation-specific improvement is
            statistically established.
          </p>
        </div>
        <Link className="robustness-link" to="/relations">
          View full Relation Analysis <ArrowRight size={16} />
        </Link>
      </article>

    </section>
  )
}

export { RobustnessLimitations }
export default RobustnessSection

