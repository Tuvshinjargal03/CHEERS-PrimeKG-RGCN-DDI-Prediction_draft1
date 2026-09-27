import {
  ArrowRight,
  BarChart3,
  Beaker,
  BookOpen,
  FlaskConical,
  LayoutDashboard,
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
    title: 'Check Medicines',
    description: 'Review two medicines together with available openFDA and PubMed sources.',
    path: '/check',
    icon: Beaker,
    tone: 'violet',
    emphasis: 'featured',
  },
  {
    title: 'My Health',
    description: 'Review information using your saved medicines and conditions.',
    path: '/my-health',
    icon: LayoutDashboard,
    tone: 'rose',
    emphasis: 'featured',
  },
  {
    title: 'Medicines and diseases',
    description: 'Find grounded medicine and condition information with available sources.',
    links: [
      { path: '/medicines', label: 'Medicines' },
      { path: '/diseases', label: 'Diseases' },
    ],
    icon: Pill,
    tone: 'blue',
  },
  {
    title: 'Explore graph context',
    description: 'View entity and shared G3 gene/protein or disease context.',
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
            Search for a medicine or disease, then review available sources, graph context,
            and clearly separated research information.
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
            <h2 id="quick-actions-title">Choose where to start</h2>
          </div>
          <p>Search above, check a medicine pair, or use saved health information without reading a long guide first.</p>
        </div>

        <div className="public-quick-grid">
          {QUICK_ACTIONS.map(({ title, description, path, links, icon: Icon, tone, emphasis }) => {
            const Card = links ? 'article' : Link
            return (
              <Card className={`public-quick-card is-${tone}${emphasis ? ` is-${emphasis}` : ''}${links ? ' public-browse-card' : ''}`} to={path} key={title}>
                <span className="public-quick-icon"><Icon size={21} /></span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  {links && (
                    <div className="public-gateway-links">
                      {links.map((link) => <Link key={link.path} to={link.path}>{link.label} <ArrowRight size={15} aria-hidden="true" /></Link>)}
                    </div>
                  )}
                </div>
                {!links && <ArrowRight className="public-quick-arrow" size={18} aria-hidden="true" />}
              </Card>
            )
          })}
        </div>
      </section>

      <section className="public-section public-home-flow" aria-labelledby="capabilities-title">
        <div className="public-section-heading">
          <span className="eyebrow">Know what you are viewing</span>
          <h2 id="capabilities-title">Four separate kinds of information</h2>
          <p>CHEERS keeps sourced information, external evidence, graph context, and model ranking distinct.</p>
        </div>
        <ul className="public-flow-list public-information-grid">
          <li>
            <span><Pill size={18} /></span>
            <div>
              <strong>Grounded medicine and disease information</strong>
              <p>Available medicine details and disease information are shown with their supporting sources.</p>
            </div>
          </li>
          <li>
            <span><Beaker size={18} /></span>
            <div>
              <strong>External pair evidence</strong>
              <p>openFDA label information and PubMed records are independent from the R-GCN score. Missing evidence does not confirm non-interaction or safety.</p>
            </div>
          </li>
          <li>
            <span><Network size={18} /></span>
            <div>
              <strong>Knowledge-graph context</strong>
              <p>Shared relationships provide context, not proof of interaction, causation, or safety.</p>
            </div>
          </li>
          <li>
            <span><Search size={18} /></span>
            <div>
              <strong>R-GCN research ranking</strong>
              <p>The R-GCN score is a ranking score—not probability, risk, severity, confidence, diagnosis, or treatment advice.</p>
            </div>
          </li>
        </ul>
      </section>

      <aside className="public-scope-note public-home-scope" aria-labelledby="public-scope-title">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <h2 id="public-scope-title">A research and information prototype</h2>
          <p>
            CHEERS is not clinical decision support. It cannot diagnose a condition, determine
            whether a combination is safe for you, or advise starting, stopping, or changing
            treatment. Missing interaction or evidence is not confirmation of safety.
          </p>
        </div>
      </aside>

      <section className="public-research-gateway" aria-labelledby="public-research-title">
        <div>
          <span className="eyebrow">Behind the product</span>
          <h2 id="public-research-title">Built on CHEERS knowledge-graph DDI research</h2>
          <p>Review the model, controlled results, relation analysis, and study methods.</p>
        </div>
        <div className="public-gateway-links">
          <Link to="/predictor"><Search size={18} /> DDI Predictor</Link>
          <Link to="/experiments"><BookOpen size={18} /> Experiments</Link>
          <Link to="/relations"><BarChart3 size={18} /> Relation Analysis</Link>
          <Link to="/methodology"><FlaskConical size={18} /> Methodology</Link>
        </div>
      </section>
    </div>
  )
}
