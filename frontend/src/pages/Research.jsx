import { ArrowRight, BarChart3, Database, FlaskConical, GitBranch, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

const VARIANTS = [
  ['G0', 'DDI only', 'Baseline interaction graph'],
  ['G1', 'Molecular context', 'Adds target, enzyme, transporter, and carrier relationships'],
  ['G2', 'Disease context', 'Adds indication, contraindication, and off-label relationships'],
  ['G3', 'Combined context', 'Adds both molecular and disease relationships'],
]

const RESULTS = [
  ['G0', 'DDI only', '0.527284', '0.006373'],
  ['G1', 'Molecular context', '0.530969', '0.007414'],
  ['G2', 'Disease context', '0.526776', '0.007482'],
  ['G3', 'Combined context', '0.534209', '0.006288'],
]

const RELATIONS = [
  ['Target', '+0.006766'], ['Carrier', '+0.002479'], ['Indication', '+0.002107'],
  ['Transporter', '+0.001410'], ['Enzyme', '-0.003531'],
  ['Contraindication', '-0.003817'], ['Off-label', '-0.012625'],
]

export default function Research() {
  return (
    <main className="page research-page">
      <header className="research-hero">
        <span className="eyebrow">RESEARCH QUESTION</span>
        <h1>Research</h1>
        <p className="research-subtitle">How different biomedical knowledge graph designs affected drug-drug interaction prediction in CHEERS.</p>
        <h2>Does adding different types of biomedical knowledge improve R-GCN drug-drug interaction prediction?</h2>
        <p>We trained the same R-GCN setup on four versions of the graph. Only the surrounding biomedical relationships were changed.</p>
      </header>

      <nav className="research-section-nav" aria-label="Research overview sections">
        <a href="#research-comparison">Comparison</a><a href="#research-result">Main result</a><a href="#research-relations">Relations</a><a href="#research-method">Method</a><a href="#research-tools">Tools</a>
      </nav>

      <section id="research-comparison" className="research-story-section" aria-labelledby="research-comparison-title">
        <div className="research-section-heading"><span className="eyebrow">FOUR CONTROLLED GRAPHS</span><h2 id="research-comparison-title">What did we compare?</h2></div>
        <div className="research-variant-grid">
          {VARIANTS.map(([code, title, description]) => <article key={code}><span>{code}</span><h3>{title}</h3><p>{description}</p></article>)}
        </div>
      </section>

      <section id="research-result" className="research-story-section research-result-section" aria-labelledby="research-result-title">
        <div className="research-section-heading"><span className="eyebrow">FIVE TRAINING RUNS · SEEDS 42–46</span><h2 id="research-result-title">What happened?</h2></div>
        <div className="research-mrr-chart" role="img" aria-label="Five-seed mean MRR: G0 0.527284, G1 0.530969, G2 0.526776, and G3 0.534209. G3 has the highest observed mean. Full zero-to-one scale.">
          <p className="research-scale-note">Full 0–1 MRR scale · mean ± SD</p>
          {RESULTS.map(([code, label, mean, spread]) => (
            <div className={`research-mrr-row ${code === 'G3' ? 'is-highest' : ''}`} key={code}>
              <div><strong>{code}</strong><span>{label}</span></div>
              <div className="research-mrr-track"><span style={{ width: `${Number(mean) * 100}%` }} /></div>
              <div><strong>{Number(mean).toFixed(4)}</strong><small>Mean {mean} ± {spread}</small>{code === 'G3' ? <em>Highest observed mean</em> : null}</div>
            </div>
          ))}
        </div>
        <div className="research-result-summary">
          <h3>G3 had the highest average MRR across five seeds, but the difference from G0 was small and was not statistically conclusive.</h3>
          <dl><div><dt>Mean difference vs G0</dt><dd>+0.006924</dd></div><div><dt>95% paired interval</dt><dd>[-0.002624, +0.016473]</dd></div><div><dt>Exact sign-flip p</dt><dd>0.0625</dd></div></dl>
        </div>
      </section>

      <section className="research-story-section" aria-labelledby="research-meaning-title">
        <div className="research-section-heading"><h2 id="research-meaning-title">What does this mean?</h2></div>
        <ul className="research-takeaways"><li>More biomedical information did not automatically improve prediction.</li><li>The type of relationship added to the graph mattered.</li><li>The combined graph had the highest observed average, but the evidence was not strong enough to establish statistical superiority.</li></ul>
      </section>

      <section id="research-relations" className="research-story-section" aria-labelledby="research-relations-title">
        <div className="research-section-heading"><span className="eyebrow">SINGLE-RELATION FOLLOW-UP</span><h2 id="research-relations-title">Which relationships mattered?</h2><p>Mean MRR differences relative to the paired G0 baseline.</p></div>
        <div className="research-relation-list" aria-label="Descriptive relation-ablation mean MRR differences">
          {RELATIONS.map(([name, value]) => <div key={name}><strong>{name}</strong><span className={value.startsWith('+') ? 'positive' : 'negative'}>{value}</span></div>)}
        </div>
        <p className="research-boundary"><strong>These are descriptive differences.</strong> Every paired interval included zero, so no individual relation type was proven beneficial.</p>
        <Link className="text-action" to="/relations">View detailed relation analysis <ArrowRight size={15} aria-hidden="true" /></Link>
      </section>

      <section id="research-method" className="research-story-section" aria-labelledby="research-method-title">
        <div className="research-section-heading"><span className="eyebrow">CONTROLLED EXPERIMENT</span><h2 id="research-method-title">How was the experiment controlled?</h2></div>
        <div className="research-control-grid">
          <article><h3>Same in all variants</h3><ul><li>Train, validation, and test DDI split</li><li>Node and candidate populations</li><li>Relation slots</li><li>R-GCN architecture and DDI decoder</li><li>Optimizer, learning rate, and training setup</li><li>Checkpoint policy and filtered ranking evaluation</li></ul></article>
          <article className="changed"><h3>Changed</h3><p>The biomedical relationships included around the DDI graph.</p></article>
        </div>
      </section>

      <section className="research-story-section" aria-labelledby="research-data-title">
        <div className="research-section-heading"><span className="eyebrow">DATASET</span><h2 id="research-data-title">What data was used?</h2></div>
        <div className="research-dataset-grid"><article><Database size={22} aria-hidden="true" /><h3>PrimeKG training graph</h3><dl><div><dt>Unique undirected DDI pairs</dt><dd>1,336,314</dd></div><div><dt>Train / validation / test</dt><dd>1,069,080 / 133,620 / 133,614</dd></div><div><dt>Shared nodes</dt><dd>13,094</dd></div><div><dt>Candidate drugs</dt><dd>4,278</dd></div></dl></article><article><GitBranch size={22} aria-hidden="true" /><h3>DDInter external exploration</h3><p>DDInter was used for exploratory external evaluation, not for training.</p></article></div>
      </section>

      <section id="research-tools" className="research-story-section" aria-labelledby="research-tools-title">
        <div className="research-section-heading"><span className="eyebrow">CONTINUE EXPLORING</span><h2 id="research-tools-title">Research details and tools</h2></div>
        <div className="research-tool-grid">
          <Link to="/experiments"><BarChart3 size={21} /><strong>Detailed results</strong><span>Per-seed results, tables, plots, and statistical tests</span></Link>
          <Link to="/relations"><GitBranch size={21} /><strong>Relation analysis</strong><span>Full paired single-relation results</span></Link>
          <Link to="/methodology"><FlaskConical size={21} /><strong>Methodology</strong><span>Exactly how the experiment was performed</span></Link>
          <Link to="/predictor"><Search size={21} /><strong>Research Predictor</strong><span>Try the saved trained research model</span></Link>
        </div>
      </section>
    </main>
  )
}
