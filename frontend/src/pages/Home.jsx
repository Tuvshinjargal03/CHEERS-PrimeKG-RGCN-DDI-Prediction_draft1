import {
  ArrowRight,
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
    title: 'Check medicines together',
    description: 'Compare two medicines and review available openFDA and PubMed sources.',
    path: '/check',
    icon: Beaker,
    tone: 'violet',
    emphasis: 'featured',
  },
  {
    title: 'Browse medicines and diseases',
    description: 'Open medicine details and condition information with available sources.',
    links: [
      { path: '/medicines', label: 'Medicines' },
      { path: '/diseases', label: 'Diseases' },
    ],
    icon: Pill,
    tone: 'blue',
  },
  {
    title: 'My Health',
    description: 'Bring saved medicines and conditions together to review available information.',
    path: '/my-health',
    icon: LayoutDashboard,
    tone: 'rose',
  },
  {
    title: 'Explore connections',
    description: 'See shared G3 gene/protein and disease relationships for two medicines.',
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
            Search medicines, diseases, side effects, and available evidence and context
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
          <p>Move from available information to its sources and deeper context whenever you need it.</p>
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
          <span className="eyebrow">Available information</span>
          <h2 id="capabilities-title">What can CHEERS help with?</h2>
        </div>
        <ul className="public-flow-list">
          <li>
            <span><Pill size={18} /></span>
            <div>
              <small>Source-backed medicine and disease information</small>
              <strong>What information is available about this medicine or disease?</strong>
              <p>CHEERS provides available medicine details and disease information, including supported label, nutrition, lifestyle, and relationship information.</p>
              <div className="public-gateway-links">
                <Link to="/medicines">Browse medicines</Link>
                <Link to="/diseases">Browse diseases</Link>
              </div>
            </div>
          </li>
          <li>
            <span><Beaker size={18} /></span>
            <div>
              <small>External pair evidence</small>
              <strong>What do checked sources say about these two medicines?</strong>
              <p>CHEERS retrieves available openFDA label information and related PubMed records for the selected pair, separately from graph context and model predictions.</p>
              <div className="public-gateway-links"><Link to="/check">Check medicines</Link></div>
            </div>
          </li>
          <li>
            <span><Network size={18} /></span>
            <div>
              <small>Graph context</small>
              <strong>What graph context do these medicines share?</strong>
              <p>CHEERS shows shared G3 gene/protein and disease relationships. Shared graph context is not an interaction or safety verdict.</p>
              <div className="public-gateway-links"><Link to="/graph">Explore graph</Link></div>
            </div>
          </li>
          <li>
            <span><Search size={18} /></span>
            <div>
              <small>R-GCN research ranking</small>
              <strong>What candidates does the research model rank for this medicine?</strong>
              <p>CHEERS shows eligible unobserved PrimeKG candidate links ranked by the R-GCN using raw model scores. These are research ranking values, not clinical probability, severity, confidence, or risk.</p>
              <div className="public-gateway-links"><Link to="/predictor">Open Research Predictor</Link></div>
            </div>
          </li>
        </ul>
      </section>

      <aside className="public-scope-note public-home-scope" aria-labelledby="public-scope-title">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <h2 id="public-scope-title">Information, not a personal prescription</h2>
          <p>
            CHEERS organizes available sources, graph relationships, and research rankings.
            It cannot diagnose a condition, determine whether a combination is safe for you,
            or advise starting, stopping, or changing treatment. Missing evidence and high model
            scores are not clinical conclusions.
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
