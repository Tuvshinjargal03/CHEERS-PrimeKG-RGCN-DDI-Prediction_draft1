import {
  BarChart3,
  Beaker,
  FlaskConical,
  GitBranch,
  Home,
  Network,
  Search,
} from 'lucide-react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import DDIPredictor from './pages/DDIPredictor.jsx'
import Evidence from './pages/Evidence.jsx'
import Experiments from './pages/Experiments.jsx'
import GraphExplorer from './pages/GraphExplorer.jsx'
import Methodology from './pages/Methodology.jsx'
import RelationAnalysis from './pages/RelationAnalysis.jsx'

const navigation = [
  { path: '/overview', label: 'Overview', icon: Home },
  { path: '/experiments', label: 'Experiments', icon: BarChart3 },
  { path: '/relations', label: 'Relation Analysis', icon: GitBranch },
  { path: '/predictor', label: 'DDI Predictor', icon: Search },
  { path: '/graph', label: 'Graph Explorer', icon: Network },
  { path: '/evidence', label: 'Evidence', icon: Beaker },
  { path: '/methodology', label: 'Methodology', icon: FlaskConical },
]

function Page({ eyebrow, title, description, children }) {
  return (
    <section className="page">
      <div className="page-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </section>
  )
}

function Overview() {
  return (
    <Page
      eyebrow="CHEERS Graduation Project"
      title="Knowledge Graph Composition for DDI Prediction"
      description="Investigating how biomedical relation composition affects R-GCN drug–drug interaction link prediction."
    >
      <div className="hero-grid">
        <article className="hero-card primary-card">
          <div className="hero-icon">
            <Network size={28} />
          </div>
          <span className="card-kicker">Research question</span>
          <h2>Which biomedical knowledge improves DDI prediction?</h2>
          <p>
            We compare four graph compositions while holding the DDI split,
            R-GCN architecture, decoder, and evaluation protocol fixed.
          </p>
        </article>

        <article className="hero-card finding-card">
          <span className="card-kicker">Strongest overall result</span>
          <div className="metric-value">G3</div>
          <h3>DDI + Drug–Gene/Protein + Drug–Disease</h3>
          <p>
            Best five-seed mean across the primary ranking metrics and the
            complementary classification metrics.
          </p>
        </article>
      </div>

      <div className="section-block">
        <div className="section-title">
          <div>
            <span className="eyebrow">Graph variants</span>
            <h2>Controlled graph composition study</h2>
          </div>
        </div>

        <div className="variant-grid">
          {[
            ['G0', 'DDI only', 'Baseline graph'],
            ['G1', '+ Drug–Gene/Protein', 'Molecular context'],
            ['G2', '+ Drug–Disease', 'Disease context'],
            ['G3', '+ Both context groups', 'Full heterogeneous graph'],
          ].map(([name, composition, note]) => (
            <article className="variant-card" key={name}>
              <span className="variant-name">{name}</span>
              <h3>{composition}</h3>
              <p>{note}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="section-block research-flow">
        <span className="eyebrow">Final system</span>
        <h2>Prediction → graph context → supporting evidence</h2>
        <div className="flow-row">
          <span>Query drug</span>
          <b>→</b>
          <span>Top-K predicted links</span>
          <b>→</b>
          <span>Biomedical subgraph</span>
          <b>→</b>
          <span>FDA / PubMed evidence</span>
        </div>
      </div>
    </Page>
  )
}

function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Network size={23} />
          </div>
          <div>
            <strong>CHEERS</strong>
            <span>PrimeKG · R-GCN</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navigation.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'active' : ''}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <div>
            <strong>Research prototype</strong>
            <span>Not for clinical decision-making</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route
            path="/experiments"
            element={<Experiments />}
          />
          <Route
            path="/relations"
            element={<RelationAnalysis />}
          />
          <Route
            path="/predictor"
            element={<DDIPredictor />}
          />
          <Route
            path="/graph"
            element={<GraphExplorer />}
          />
          <Route
            path="/evidence"
            element={<Evidence />}
          />
          <Route
            path="/methodology"
            element={<Methodology />}
          />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}
