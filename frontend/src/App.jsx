import {
  BarChart3,
  Beaker,
  Bookmark,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  GitBranch,
  HeartPulse,
  Home,
  LayoutDashboard,
  Network,
  Pill,
  Search,
  Share2,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './index.css'

const DDIPredictor = lazy(() => import('./pages/DDIPredictor.jsx'))
const DiseaseGuide = lazy(() => import('./pages/DiseaseGuide.jsx'))
const Evidence = lazy(() => import('./pages/Evidence.jsx'))
const Experiments = lazy(() => import('./pages/Experiments.jsx'))
const GraphExplorer = lazy(() => import('./pages/GraphExplorer.jsx'))
const HomePage = lazy(() => import('./pages/Home.jsx'))
const Methodology = lazy(() => import('./pages/Methodology.jsx'))
const MedicineChecker = lazy(() => import('./pages/MedicineChecker.jsx'))
const MedicineGuide = lazy(() => import('./pages/MedicineGuide.jsx'))
const MyHealth = lazy(() => import('./pages/MyHealth.jsx'))
const MyMedicines = lazy(() => import('./pages/MyMedicines.jsx'))
const MyConditions = lazy(() => import('./pages/MyConditions.jsx'))
const PublicSearch = lazy(() => import('./pages/PublicSearch.jsx'))
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
      { path: '/predictor', label: 'DDI Predictor', icon: Search },
      { path: '/experiments', label: 'Experiments', icon: BarChart3 },
      { path: '/relations', label: 'Relation Analysis', icon: GitBranch },
      { path: '/methodology', label: 'Methodology', icon: FlaskConical },
    ],
  },
]

const publicNavigation = [
  { path: '/overview', label: 'Home', icon: Home },
  { path: '/my-health', label: 'My Health', icon: LayoutDashboard },
  { path: '/check', label: 'Check Medicines', icon: Beaker },
  { path: '/my-medicines', label: 'My Medicines', icon: ClipboardList },
  { path: '/my-conditions', label: 'My Conditions', icon: Bookmark },
  { path: '/medicines', label: 'Medicines', icon: Pill },
  { path: '/diseases', label: 'Diseases', icon: HeartPulse },
]

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
        Back to Home
      </NavLink>
    </Page>
  )
}

function AppShell() {
  const location = useLocation()
  const navigationRef = useRef(null)
  const [openGroup, setOpenGroup] = useState(null)

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
            <span>Medicine &amp; health explorer</span>
          </div>
        </div>

        <nav
          ref={navigationRef}
          className="sidebar-nav"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpenGroup(null)
          }}
        >
          {publicNavigation.map(({ path, label, icon: Icon }, index) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                `nav-link ${index === 0 ? 'nav-home-link ' : ''}${isActive ? 'active' : ''}`
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
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
          <NavLink className="sidebar-scope-link" to="/methodology">
            <FlaskConical size={15} aria-hidden="true" />
            <span>Research-backed information</span>
          </NavLink>
        </div>
      </aside>

      <main className="main-content">
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<HomePage />} />
            <Route path="/my-health" element={<MyHealth />} />
            <Route path="/search" element={<PublicSearch />} />
            <Route path="/check" element={<MedicineChecker />} />
            <Route path="/my-medicines" element={<MyMedicines />} />
            <Route path="/my-conditions" element={<MyConditions />} />
            <Route path="/medicines" element={<MedicineGuide />} />
            <Route path="/medicines/:drugId" element={<MedicineGuide />} />
            <Route path="/diseases" element={<DiseaseGuide />} />
            <Route path="/diseases/:diseaseId" element={<DiseaseGuide />} />
            <Route path="/experiments" element={<Experiments />} />
            <Route path="/relations" element={<RelationAnalysis />} />
            <Route path="/predictor" element={<DDIPredictor />} />
            <Route path="/graph" element={<GraphExplorer />} />
            <Route path="/subgraph" element={<SubgraphExplorer />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/methodology" element={<Methodology />} />
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
