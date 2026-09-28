import {
  ArrowRight, BarChart3, Beaker, BookOpen, HeartPulse,
  LayoutDashboard, Network, Pill, Search, ShieldCheck,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import PublicSearchBox from '../components/PublicSearchBox.jsx'
import { PUBLIC_SEARCH_EXAMPLES } from '../data/publicSearchExamples.js'
import './PublicSearch.css'

const PRIMARY_ACTIONS = [
  ['Ask about a medicine', 'Find uses, side effects, and source-backed medicine information.', 'Ask CHEERS', '/search', Search],
  ['Check Medicines', 'Review two medicines together using available FDA and PubMed evidence.', 'Check Medicines', '/check', Beaker],
  ['My Health', 'Use your saved medicines and conditions for faster review.', 'Open My Health', '/my-health', LayoutDashboard],
]

const INFORMATION_TYPES = [
  ['Medicine info', 'Uses and side effects', Pill],
  ['FDA & PubMed', 'External sources', BookOpen],
  ['Research connections', 'Related genes, proteins, and diseases', Network],
  ['Model results', 'Research ranking only', BarChart3],
]

const ADVANCED_LINKS = [
  ['/research', 'Research overview', BarChart3],
  ['/predictor', 'Research Predictor', Search],
  ['/graph', 'Explore relationships', Network],
]

export default function Home() {
  const navigate = useNavigate()
  const search = (query) => navigate(`/search?q=${encodeURIComponent(query)}`)

  return (
    <div className="public-home">
      <section className="public-hero public-product-hero" aria-labelledby="public-home-title">
        <div className="public-node-motif" aria-hidden="true">
          <span className="public-node public-node-one" /><span className="public-node public-node-two" />
          <span className="public-node public-node-three" /><span className="public-node-line public-node-line-one" />
          <span className="public-node-line public-node-line-two" />
        </div>
        <div className="public-hero-copy">
          <span className="public-brand-word">CHEERS</span>
          <h1 id="public-home-title">Understand your medicines better.</h1>
          <p>Ask a question, compare two medicines, or explore clear source-backed information.</p>
        </div>
        <PublicSearchBox label="Search CHEERS" placeholder="Ask about a medicine, disease, or interaction…" onSearch={search} />
        <div className="public-example-list" aria-label="Example searches">
          <span>Try:</span>
          {PUBLIC_SEARCH_EXAMPLES.map((example) => (
            <button type="button" key={example} onClick={() => search(example)}>{example}</button>
          ))}
        </div>
      </section>

      <section className="public-section public-actions-section" aria-labelledby="quick-actions-title">
        <div className="public-section-heading">
          <span className="eyebrow">Get started</span>
          <h2 id="quick-actions-title">Choose what you want to do</h2>
          <p>Find medicine information, compare medicines, or use your saved health information.</p>
        </div>
        <div className="public-primary-action-grid">
          {PRIMARY_ACTIONS.map(([title, description, cta, path, Icon]) => (
            <Link className="public-primary-action" to={path} key={title}>
              <span className="public-quick-icon"><Icon size={22} aria-hidden="true" /></span>
              <div><h3>{title}</h3><p>{description}</p></div>
              <span className="public-card-cta">{cta} <ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="public-secondary-section" aria-labelledby="browse-title">
        <div><h2 id="browse-title">Browse information</h2><p>Browse supported medicine and condition information directly.</p></div>
        <div className="public-inline-links">
          <Link to="/medicines"><Pill size={18} aria-hidden="true" /> Medicines</Link>
          <Link to="/diseases"><HeartPulse size={18} aria-hidden="true" /> Diseases</Link>
        </div>
      </section>

      <section className="public-section public-home-flow public-information-strip" aria-labelledby="capabilities-title">
        <div className="public-section-heading">
          <h2 id="capabilities-title">What you can explore</h2>
        </div>
        <ul className="public-information-tiles">
          {INFORMATION_TYPES.map(([title, description, Icon]) => (
            <li key={title}><span><Icon size={18} aria-hidden="true" /></span><div><strong>{title}</strong><p>{description}</p></div></li>
          ))}
        </ul>
        <div className="public-information-footer">
          <p>Research connections and model results are for exploration, not medical advice.</p>
          <Link to="/methodology">How CHEERS works <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      </section>

      <aside className="public-scope-note public-home-scope" aria-labelledby="public-scope-title">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <h2 id="public-scope-title">Important</h2>
          <p>CHEERS provides research and source-backed health information. It does not diagnose conditions, choose treatments, or confirm that a medicine combination is safe.</p>
          <Link className="text-action" to="/methodology">Read methodology <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      </aside>

      <section className="public-section public-advanced-section" aria-labelledby="advanced-title">
        <div className="public-section-heading">
          <h2 id="advanced-title">Research &amp; advanced tools</h2>
          <p>Explore biomedical relationships or review the research behind CHEERS.</p>
        </div>
        <div className="public-advanced-links">
          {ADVANCED_LINKS.map(([path, label, Icon]) => (
            <Link to={path} key={path}><Icon size={18} aria-hidden="true" /> {label}</Link>
          ))}
        </div>
      </section>
    </div>
  )
}
