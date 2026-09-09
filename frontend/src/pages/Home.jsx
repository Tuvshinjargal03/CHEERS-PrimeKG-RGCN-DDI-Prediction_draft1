import {
  ArrowRight,
  Beaker,
  BookOpen,
  FlaskConical,
  HeartPulse,
  Network,
  Pill,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import PublicSearchBox from '../components/PublicSearchBox.jsx'
import { PUBLIC_SEARCH_EXAMPLES } from '../data/publicSearchExamples.js'
import './PublicSearch.css'

const QUICK_ACTIONS = [
  {
    title: 'Check medicines together',
    description: 'Compare two medicines and review available interaction-related sources.',
    path: '/check',
    icon: Beaker,
    tone: 'violet',
    emphasis: 'featured',
  },
  {
    title: 'Medicine guide',
    description: 'Find medicine information, warnings, interactions, and side effects when available.',
    path: '/medicines',
    icon: Pill,
    tone: 'blue',
  },
  {
    title: 'Disease guide',
    description: 'Read clear disease explanations and explore verified treatment relationships.',
    path: '/diseases',
    icon: HeartPulse,
    tone: 'rose',
  },
  {
    title: 'Explore connections',
    description: 'See deeper gene, disease, and medicine connections in the biomedical graph.',
    path: '/graph',
    icon: Network,
    tone: 'green',
    emphasis: 'advanced',
  },
]

export default function Home() {
  const navigate = useNavigate()

  function search(query) {
    navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  return (
    <div className="public-home">
      <section className="public-hero public-product-hero" aria-labelledby="public-home-title">
        <div className="public-node-motif" aria-hidden="true">
          <span className="public-node public-node-one" />
          <span className="public-node public-node-two" />
          <span className="public-node public-node-three" />
          <span className="public-node-line public-node-line-one" />
          <span className="public-node-line public-node-line-two" />
        </div>

        <div className="public-hero-copy">
          <span className="public-brand-word">CHEERS</span>
          <h1 id="public-home-title">Understand your medicines better.</h1>
          <p>
            Search medicines, diseases, side effects, and interaction information
            — with sources you can explore.
          </p>
        </div>

        <PublicSearchBox
          label="Search CHEERS"
          placeholder="Ask about a medicine, disease, or interaction…"
          onSearch={search}
        />

        <div className="public-example-list" aria-label="Example searches">
          <span>Try:</span>
          {PUBLIC_SEARCH_EXAMPLES.map((example) => (
            <button type="button" key={example} onClick={() => search(example)}>
              {example}
            </button>
          ))}
        </div>
      </section>

      <section className="public-section public-actions-section" aria-labelledby="quick-actions-title">
        <div className="public-section-heading public-section-heading-row">
          <div>
            <span className="eyebrow">What would you like to do?</span>
            <h2 id="quick-actions-title">Start with a simple question</h2>
          </div>
          <p>Move from a quick answer to its sources and deeper context whenever you need it.</p>
        </div>

        <div className="public-quick-grid">
          {QUICK_ACTIONS.map(({ title, description, path, icon: Icon, tone, emphasis }) => (
            <Link className={`public-quick-card is-${tone}${emphasis ? ` is-${emphasis}` : ''}`} to={path} key={title}>
              <span className="public-quick-icon"><Icon size={21} /></span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <ArrowRight className="public-quick-arrow" size={18} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className="public-section public-home-flow" aria-label="How CHEERS helps">
        <ol className="public-flow-list">
          <li>
            <span><Search size={18} /></span>
            <div><strong>Search</strong><p>Ask about a medicine, disease, or medicine pair.</p></div>
          </li>
          <li>
            <span><BookOpen size={18} /></span>
            <div><strong>Read available information</strong><p>See clear, source-backed details.</p></div>
          </li>
          <li>
            <span><Network size={18} /></span>
            <div><strong>Explore sources or research</strong><p>Open deeper connections only when useful.</p></div>
          </li>
        </ol>
      </section>

      <aside className="public-scope-note public-home-scope" aria-labelledby="public-scope-title">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <h2 id="public-scope-title">Information, not a personal prescription</h2>
          <p>
            CHEERS cannot decide whether a medicine or combination is right for you.
            Missing information does not mean a combination is safe.
          </p>
        </div>
      </aside>

      <section className="public-research-gateway" aria-labelledby="public-research-title">
        <div>
          <span className="eyebrow">Behind the product</span>
          <h2 id="public-research-title">Built on CHEERS knowledge-graph DDI research</h2>
          <p>Explore the experiments, research predictor, and methodology behind the system.</p>
        </div>
        <div className="public-gateway-links">
          <Link to="/experiments"><BookOpen size={18} /> Experiments</Link>
          <Link to="/predictor"><Search size={18} /> Research Predictor</Link>
          <Link to="/methodology"><FlaskConical size={18} /> Methodology</Link>
        </div>
      </section>
    </div>
  )
}
