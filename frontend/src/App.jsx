import {
  BarChart3,
  Beaker,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  GitBranch,
  Home,
  Network,
  Search,
  Share2,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import InfoTooltip from './components/InfoTooltip.jsx'
import './index.css'

const DDIPredictor = lazy(() => import('./pages/DDIPredictor.jsx'))
const Evidence = lazy(() => import('./pages/Evidence.jsx'))
const Experiments = lazy(() => import('./pages/Experiments.jsx'))
const GraphExplorer = lazy(() => import('./pages/GraphExplorer.jsx'))
const Methodology = lazy(() => import('./pages/Methodology.jsx'))
const RelationAnalysis = lazy(() => import('./pages/RelationAnalysis.jsx'))
const SubgraphExplorer = lazy(() => import('./pages/SubgraphExplorer.jsx'))

const navigationGroups = [
  {
    label: 'Explore',
    icon: Network,
    items: [
      { path: '/graph', label: 'Graph Explorer', icon: Network },
      { path: '/subgraph', label: 'Subgraph Explorer', icon: Share2 },
    ],
  },
  {
    label: 'Research',
    icon: BarChart3,
    items: [
      { path: '/experiments', label: 'Experiments', icon: BarChart3 },
      { path: '/relations', label: 'Relation Analysis', icon: GitBranch },
    ],
  },
  {
    label: 'Reference',
    icon: Beaker,
    items: [
      { path: '/evidence', label: 'Evidence', icon: Beaker },
      { path: '/methodology', label: 'Methodology', icon: FlaskConical },
    ],
  },
]

const homeNavigation = { path: '/overview', label: 'Home', icon: Home }
const predictorNavigation = { path: '/predictor', label: 'DDI Predictor', icon: Search }

function ExpandableNavigation({ group, isActive, isOpen, onToggle, onClose }) {
  const triggerRef = useRef(null)
  const submenuId = `${group.label.toLowerCase()}-navigation-submenu`
  const GroupIcon = group.icon

  function closeWithKeyboard(event) {
    if (event.key !== 'Escape' || isActive) return
    event.stopPropagation()
    onClose()
    triggerRef.current?.focus()
  }

  return (
    <div
      className={`nav-expandable ${isOpen ? 'is-open' : ''}`}
      onKeyDown={closeWithKeyboard}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`nav-link nav-expandable-trigger ${isActive ? 'active' : ''}`}
        aria-expanded={isOpen}
        aria-controls={submenuId}
        onClick={onToggle}
      >
        <GroupIcon size={20} />
        <span>{group.label}</span>
        {isOpen
          ? <ChevronDown className="nav-chevron" size={15} aria-hidden="true" />
          : <ChevronRight className="nav-chevron" size={15} aria-hidden="true" />}
      </button>

      {isOpen && (
        <div id={submenuId} className="nav-submenu" aria-label={`${group.label} pages`}>
          {group.items.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              title={label}
              onClick={onClose}
              className={({ isActive }) =>
                `nav-link nav-submenu-link ${isActive ? 'active' : ''}`
              }
            >
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
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
      eyebrow="CHEERS · Research prototype"
      title={
        <>
          Biomedical context for drug–drug interaction research{' '}
          <InfoTooltip
            label="What DDI means in CHEERS"
            placement="bottom"
            text="Drug–drug interaction (DDI) is represented here as a link-prediction task between drug entities in the knowledge graph."
          />
        </>
      }
      description="CHEERS evaluates how biomedical knowledge graph composition affects R-GCN drug–drug interaction prediction while also providing prediction and graph-exploration tools."
    >
      <div className="home-actions" aria-label="Primary actions">
        <NavLink className="primary-button" to="/predictor">
          <Search size={18} />
          Check Drug Pair
        </NavLink>
        <NavLink className="secondary-button home-secondary-action" to="/graph">
          <Network size={18} />
          Explore Connections
        </NavLink>
        <NavLink className="text-action home-research-action" to="/experiments">
          <BarChart3 size={18} />
          View Research Results
        </NavLink>
      </div>
      <p className="home-boundary">
        Research prototype · raw model scores are ranking scores, not probabilities
        or clinical-risk estimates.
      </p>

      <article className="home-result-panel">
        <div className="home-result-copy">
          <span className="card-kicker">Primary research result · 5 seeds</span>
          <h2>G3 achieved the strongest overall five-seed mean internal performance.</h2>
          <p>
            Improvement over G0 was consistent across all four ranking metrics
            and five paired training seeds, but modest and not statistically
            significant at the conventional 0.05 threshold.
          </p>
          <div className="home-result-details">
            <span>G3−G0 mean MRR difference <strong>+0.006924</strong></span>
            <span>Exact sign-flip <strong>p = 0.0625</strong></span>
          </div>
        </div>
        <div className="home-result-metric" aria-label="G3 mean reciprocal rank 0.534209 plus or minus 0.006288">
          <span>G3 MRR</span>
          <strong>0.534209</strong>
          <small>± 0.006288</small>
        </div>
        <NavLink className="secondary-button home-result-link" to="/experiments">
          See experiment results
        </NavLink>
      </article>

      <section className="home-workflow" aria-labelledby="home-workflow-heading">
        <div className="home-section-heading">
          <span className="eyebrow">How to use CHEERS</span>
          <h2 id="home-workflow-heading">Predict, explore, then review</h2>
        </div>
        <div className="home-workflow-grid">
          <article><span>1</span><h3>Predict</h3><p>Rank candidate drug–drug links.</p></article>
          <article><span>2</span><h3>Explore</h3><p>Inspect available verified G3 gene/protein and disease context.</p></article>
          <article><span>3</span><h3>Review</h3><p>Examine independent external information.</p></article>
        </div>
        <div className="home-workflow-footer">
          <p>Graph context and external information do not explain or clinically validate model scores.</p>
          <NavLink className="text-action" to="/subgraph">
            Explore one drug’s neighborhood <Share2 size={15} />
          </NavLink>
        </div>
      </section>

      <div className="home-section-heading home-research-heading">
        <span className="eyebrow">Research at a glance</span>
        <h2>Controlled knowledge graph composition study</h2>
      </div>

      <div className="hero-grid home-research-grid">
        <article className="hero-card primary-card">
          <div className="hero-icon">
            <Network size={28} />
          </div>
          <span className="card-kicker">Research question</span>
          <h2>
            Which biomedical knowledge improves DDI prediction?{' '}
            <InfoTooltip
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
            <InfoTooltip
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
              <InfoTooltip
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
          <InfoTooltip
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

function RouteLoadingFallback() {
  return (
    <div className="page" role="status" aria-live="polite" aria-busy="true">
      <p>Loading page…</p>
    </div>
  )
}

function NotFound() {
  return (
    <Page
      eyebrow="Navigation"
      title="Page not found"
      description="This page does not exist or may have moved."
    >
      <NavLink className="primary-button" to="/overview">
        Back to Overview
      </NavLink>
    </Page>
  )
}

function AppShell() {
  const location = useLocation()
  const navigationRef = useRef(null)
  const [openGroup, setOpenGroup] = useState(null)
  const HomeIcon = homeNavigation.icon
  const PredictorIcon = predictorNavigation.icon

  useEffect(() => {
    function closeManualGroup(event) {
      if (!navigationRef.current?.contains(event.target)) setOpenGroup(null)
    }

    document.addEventListener('pointerdown', closeManualGroup)
    return () => document.removeEventListener('pointerdown', closeManualGroup)
  }, [])

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

        <nav
          ref={navigationRef}
          className="sidebar-nav"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpenGroup(null)
          }}
        >
          <NavLink
            to={homeNavigation.path}
            aria-label={homeNavigation.label}
            title={homeNavigation.label}
            className={({ isActive }) =>
              `nav-link nav-home-link ${isActive ? 'active' : ''}`
            }
          >
            <HomeIcon size={20} />
            <span>{homeNavigation.label}</span>
          </NavLink>
          <NavLink
            to={predictorNavigation.path}
            aria-label={predictorNavigation.label}
            title={predictorNavigation.label}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <PredictorIcon size={20} />
            <span>{predictorNavigation.label}</span>
          </NavLink>
          {navigationGroups.map((group) => {
            const isActive = group.items.some((item) => item.path === location.pathname)
            const isOpen = isActive || openGroup === group.label

            return (
              <ExpandableNavigation
                key={group.label}
                group={group}
                isActive={isActive}
                isOpen={isOpen}
                onToggle={() => {
                  if (!isActive) {
                    setOpenGroup((current) => current === group.label ? null : group.label)
                  }
                }}
                onClose={() => setOpenGroup(null)}
              />
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div>
            <strong>Research prototype</strong>
            <span>Not for clinical decision-making</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <Suspense fallback={<RouteLoadingFallback />}>
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
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
