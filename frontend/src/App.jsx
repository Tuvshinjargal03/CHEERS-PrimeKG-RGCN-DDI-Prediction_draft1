import {
  BarChart3,
  Beaker,
  FlaskConical,
  GitBranch,
  Home,
  Network,
  Search,
  Share2,
} from 'lucide-react'
import { useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import DDIPredictor from './pages/DDIPredictor.jsx'
import Evidence from './pages/Evidence.jsx'
import Experiments from './pages/Experiments.jsx'
import GraphExplorer from './pages/GraphExplorer.jsx'
import Methodology from './pages/Methodology.jsx'
import RelationAnalysis from './pages/RelationAnalysis.jsx'
import SubgraphExplorer from './pages/SubgraphExplorer.jsx'

const navigation = [
  { path: '/overview', label: 'Overview', icon: Home },
  { path: '/experiments', label: 'Experiments', icon: BarChart3 },
  { path: '/relations', label: 'Relation Analysis', icon: GitBranch },
  { path: '/predictor', label: 'DDI Predictor', icon: Search },
  { path: '/graph', label: 'Graph Explorer', icon: Network },
  { path: '/subgraph', label: 'Subgraph Explorer', icon: Share2 },
  { path: '/evidence', label: 'Evidence', icon: Beaker },
  { path: '/methodology', label: 'Methodology', icon: FlaskConical },
]

function UniqueBulbBadge({ text, label = 'View helper note', placement = 'top' }) {
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
            ...(placement === 'bottom'
              ? { top: 'calc(100% + 8px)' }
              : { bottom: 'calc(100% + 8px)' }),
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(260px, calc(100vw - 48px))',
            padding: '10px 14px',
            background: '#1a202c',
            color: '#f7fafc',
            display: 'block',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.55,
            letterSpacing: 'normal',
            wordSpacing: 'normal',
            textTransform: 'none',
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
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
      title={
        <>
          Knowledge Graph Composition for DDI Prediction{' '}
          <UniqueBulbBadge
            label="What DDI means in CHEERS"
            placement="bottom"
            text="Drug–drug interaction (DDI) is represented here as a link-prediction task between drug entities in the knowledge graph."
          />
        </>
      }
      description="Investigating how biomedical relation composition affects R-GCN drug–drug interaction link prediction."
    >
      <div className="hero-grid">
        <article className="hero-card primary-card">
          <div className="hero-icon">
            <Network size={28} />
          </div>
          <span className="card-kicker">Research question</span>
          <h2>
            Which biomedical knowledge improves DDI prediction?{' '}
            <UniqueBulbBadge
              label="Explain the research question"
              text="This experiment tests whether adding biomedical gene/protein and disease relations changes DDI link-ranking performance while the DDI split and model setup remain fixed."
            />
          </h2>
          <p>
            We compare four graph compositions while holding the DDI split,
            R-GCN architecture, decoder, and evaluation protocol fixed.
          </p>
        </article>

        <article className="hero-card finding-card">
          <span className="card-kicker">
            Strongest overall result{' '}
            <UniqueBulbBadge
              label="Explain the G3 result"
              text="G3 combines DDI, Drug–Gene/Protein, and Drug–Disease relation groups and achieved the strongest overall five-seed mean performance among the four graph-composition variants."
            />
          </span>
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
            <h2>
              Controlled graph composition study{' '}
              <UniqueBulbBadge
                label="Explain the graph variants"
                text="G0–G3 differ in graph composition while the controlled model and DDI evaluation setup remain fixed."
              />
            </h2>
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
        <h2>
          Prediction → graph context → supporting evidence{' '}
          <UniqueBulbBadge
            label="Explain the application flow"
            text="The application connects model ranking, biomedical graph context, and independent external evidence review. Graph context and external evidence are not causal explanations of a model score."
          />
        </h2>
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
            path="/subgraph"
            element={<SubgraphExplorer />}
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
