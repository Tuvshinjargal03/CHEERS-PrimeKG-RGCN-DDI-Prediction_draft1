import {
  AlertCircle,
  Beaker,
  BookOpen,
  ExternalLink,
  Info,
  LoaderCircle,
  Pill,
  Search,
  Utensils,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PublicSearchBox from '../components/PublicSearchBox.jsx'
import { getJson } from '../lib/api.js'
import './PublicSearch.css'
import './PublicProduct.css'

const RELATION_LABELS = {
  indication: 'Indication',
  contraindication: 'Contraindication',
  off_label: 'Off-label use',
}
const DISEASE_EXAMPLES = ['type 2 diabetes mellitus', 'asthma']
const DEFAULT_INDICATION_LIMIT = 10

function sentenceCase(value) {
  const text = String(value || '')
  return text ? `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}` : text
}

function relationLabel(value) {
  return RELATION_LABELS[value] || sentenceCase(String(value).replaceAll('_', ' '))
}

function DiseaseLanding({ onSearch }) {
  return (
    <section className="page product-page disease-guide-page">
      <header className="product-page-header">
        <span className="eyebrow">Disease guide</span>
        <h1>Understand a condition</h1>
        <p>Search a disease to read an available explanation and explore medicines connected through verified biomedical relationships.</p>
      </header>
      <div className="product-input-panel disease-landing-search">
        <PublicSearchBox
          label="Search for a disease"
          placeholder="Enter a disease name…"
          onSearch={onSearch}
        />
        <p className="product-search-helper">If more than one disease matches, CHEERS will ask you to choose.</p>
        <div className="product-example-row">
          <span>Try an example</span>
          <div className="product-example-chips">
            {DISEASE_EXAMPLES.map((example) => (
              <button type="button" key={example} onClick={() => onSearch(example)}>{example}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function MedicineRelationshipCard({ item, indication = false }) {
  return (
    <article className="disease-medicine-card">
      <div className="disease-medicine-icon"><Pill size={18} /></div>
      <div className="disease-medicine-copy">
        <span className={`disease-relation-badge ${indication ? 'is-indication' : ''}`}>
          {relationLabel(item.relation)}
        </span>
        <h3>{item.drug_name}</h3>
        <p>{item.drug_id} · {item.context_source}</p>
      </div>
      <div className="disease-medicine-actions">
        <Link to={`/medicines/${encodeURIComponent(item.drug_id)}`}>View medicine</Link>
        <Link to={`/medicines/${encodeURIComponent(item.drug_id)}?section=side-effects`}>Side effects</Link>
        <Link to={`/check?drug_a_id=${encodeURIComponent(item.drug_id)}`}>Check interactions</Link>
      </div>
    </article>
  )
}

function NutritionCategory({ title, items }) {
  if (!items?.length) return null

  return (
    <article className="disease-nutrition-card">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={`${item.source_section}-${item.text}`}>
            <span>{item.text}</span>
            <small>Source section: {item.source_section}</small>
          </li>
        ))}
      </ul>
    </article>
  )
}

function DiseaseNutrition({ nutrition }) {
  const source = nutrition.source || {}
  const sourceDate = source.source_date || {}

  return (
    <section className="disease-nutrition-section" aria-labelledby="disease-nutrition-heading">
      <div className="medicine-content-heading">
        <span className="public-quick-icon"><Utensils size={20} /></span>
        <div><span className="eyebrow">General disease nutrition education</span><h2 id="disease-nutrition-heading">Nutrition &amp; lifestyle</h2></div>
      </div>

      <div className="disease-nutrition-grid">
        <NutritionCategory title="General guidance" items={nutrition.general_guidance} />
        <NutritionCategory title="Foods / food groups emphasized" items={nutrition.foods_emphasized} />
        <NutritionCategory title="Foods / nutrients limited" items={nutrition.foods_limited} />
        <NutritionCategory title="Relevant nutrients" items={nutrition.relevant_nutrients} />
      </div>

      <aside className="disease-nutrition-source">
        <div>
          <span className="eyebrow">Official source</span>
          <strong>{source.organization}</strong>
          <p>{source.page_title}</p>
          {sourceDate.value && <small>{sourceDate.label}: {sourceDate.value}</small>}
        </div>
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer">
            View official source <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </aside>

      <p className="disease-nutrition-boundary">
        <Info size={17} aria-hidden="true" />
        <span>General nutrition education for this condition. Not a personalized meal plan or medical nutrition therapy.</span>
      </p>
    </section>
  )
}

export default function DiseaseGuide() {
  const navigate = useNavigate()
  const { diseaseId } = useParams()
  const [searchParams] = useSearchParams()
  const [request, setRequest] = useState({ diseaseId: '', payload: null, error: '' })
  const [medicineFilter, setMedicineFilter] = useState('')
  const [showAllIndications, setShowAllIndications] = useState(false)
  const [otherRelationFilter, setOtherRelationFilter] = useState('all')
  const requestIsCurrent = request.diseaseId === diseaseId
  const payload = requestIsCurrent ? request.payload : null
  const error = requestIsCurrent ? request.error : ''
  const loading = Boolean(diseaseId) && !requestIsCurrent

  useEffect(() => {
    if (!diseaseId) return undefined
    let active = true
    getJson(`/api/public/disease?disease_id=${encodeURIComponent(diseaseId)}`).then(
      (result) => {
        if (active) setRequest({ diseaseId, payload: result, error: '' })
      },
      (requestError) => {
        if (active) {
          setRequest({
            diseaseId,
            payload: null,
            error: requestError.message || 'Disease information could not be loaded.',
          })
        }
      },
    )
    return () => {
      active = false
    }
  }, [diseaseId])

  if (!diseaseId) {
    return <DiseaseLanding onSearch={(query) => navigate(`/search?q=${encodeURIComponent(query)}`)} />
  }

  const disease = payload?.disease
  const indications = payload?.medicine_relationships?.indications || []
  const other = payload?.medicine_relationships?.other || []
  const nutrition = payload?.nutrition_lifestyle
  const nutritionAvailable = nutrition?.status === 'available'
  const requestedSection = searchParams.get('section')
  const activeSection = requestedSection === 'nutrition-lifestyle' && nutritionAvailable
    ? 'nutrition-lifestyle'
    : 'overview'
  const normalizedMedicineFilter = medicineFilter.trim().toLocaleLowerCase()
  const filteredIndications = normalizedMedicineFilter
    ? indications.filter((item) => (
        item.drug_name.toLocaleLowerCase().includes(normalizedMedicineFilter)
        || item.drug_id.toLocaleLowerCase().includes(normalizedMedicineFilter)
      ))
    : indications
  const visibleIndications = showAllIndications || normalizedMedicineFilter
    ? filteredIndications
    : filteredIndications.slice(0, DEFAULT_INDICATION_LIMIT)
  const otherRelationTypes = [...new Set(other.map((item) => item.relation))]
  const visibleOther = otherRelationFilter === 'all'
    ? other
    : other.filter((item) => item.relation === otherRelationFilter)

  return (
    <section className="page product-page disease-profile-page">
      <header className="disease-profile-header">
        <Link className="product-back-link" to="/diseases">← Disease guide</Link>
        <span className="eyebrow">Disease profile</span>
        <h1>{sentenceCase(disease?.name) || 'Disease information'}</h1>
        <p><span>Source entity ID</span> {disease?.entity_id || diseaseId}</p>
      </header>

      {loading && <div className="product-empty-state" role="status"><LoaderCircle className="spin" size={24} /><div><strong>Loading disease information…</strong></div></div>}
      {error && <div className="product-source-error" role="alert"><AlertCircle size={20} /><span>{error}</span></div>}

      {!loading && !error && disease && (
        <>
          {nutritionAvailable && (
            <nav className="medicine-section-nav disease-section-nav" aria-label="Disease information sections">
              <Link
                className={activeSection === 'overview' ? 'active' : ''}
                aria-current={activeSection === 'overview' ? 'page' : undefined}
                to={`/diseases/${encodeURIComponent(diseaseId)}`}
              >
                Overview
              </Link>
              <Link
                className={activeSection === 'nutrition-lifestyle' ? 'active' : ''}
                aria-current={activeSection === 'nutrition-lifestyle' ? 'page' : undefined}
                to={`/diseases/${encodeURIComponent(diseaseId)}?section=nutrition-lifestyle`}
              >
                Nutrition &amp; lifestyle
              </Link>
            </nav>
          )}

          {activeSection === 'overview' && (
            <div className="disease-overview-content">
          <section className="disease-description-card" aria-labelledby="disease-about-heading">
            <div className="medicine-content-heading">
              <span className="public-quick-icon"><BookOpen size={20} /></span>
              <div><span className="eyebrow">Simple explanation</span><h2 id="disease-about-heading">About this disease</h2></div>
            </div>
            {disease.verified_description_available ? (
              <>
                <p className="disease-description-text">{disease.description}</p>
                <p className="disease-provenance">
                  Source: {disease.description_provenance?.source}
                  {disease.description_provenance?.source_id ? ` · ${disease.description_provenance.source_id}` : ''}
                  {disease.description_provenance?.license ? ` · ${disease.description_provenance.license}` : ''}
                </p>
              </>
            ) : (
              <div className="product-card-empty medicine-section-empty"><strong>Verified explanation unavailable.</strong><p>This disease is recognized, but its current description is not approved for presentation.</p></div>
            )}
          </section>

          <section className="disease-relationship-section" aria-labelledby="indication-medicines-heading">
            <div className="product-section-title">
              <div>
                <span className="eyebrow">Treatment-related graph relationships</span>
                <h2 id="indication-medicines-heading">Medicines associated through indication</h2>
              </div>
              <span className="product-step-badge">{indications.length} {indications.length === 1 ? 'medicine' : 'medicines'}</span>
            </div>
            <p className="disease-section-intro">These medicines have an indication relationship with this disease in the knowledge graph. This is not a personalized prescription.</p>
            {indications.length ? (
              <>
                <div className="disease-list-controls">
                  <label>
                    <Search size={16} aria-hidden="true" />
                    <input
                      aria-label="Filter indication medicines"
                      type="search"
                      value={medicineFilter}
                      onChange={(event) => setMedicineFilter(event.target.value)}
                      placeholder="Filter medicines"
                    />
                  </label>
                  <small>Alphabetical source order</small>
                </div>
                {visibleIndications.length ? (
                  <div className="disease-medicine-grid">
                    {visibleIndications.map((item) => <MedicineRelationshipCard key={`${item.drug_id}-${item.relation}`} item={item} indication />)}
                  </div>
                ) : (
                  <div className="product-empty-state"><Info size={22} /><div><strong>No medicine matches this filter.</strong></div></div>
                )}
                {!normalizedMedicineFilter && indications.length > DEFAULT_INDICATION_LIMIT && (
                  <button type="button" className="secondary-button disease-show-more" onClick={() => setShowAllIndications((current) => !current)}>
                    {showAllIndications ? 'Show fewer' : `Show all ${indications.length}`}
                  </button>
                )}
              </>
            ) : (
              <div className="product-empty-state"><Info size={22} /><div><strong>No indication relationship is available.</strong><p>This does not mean there are no treatments for this disease.</p></div></div>
            )}
          </section>

          <details className="disease-other-disclosure">
            <summary>
              <div><span className="eyebrow">Kept separate from indications</span><h2 id="other-medicines-heading">Other biomedical relationships</h2></div>
              <span className="product-step-badge">{other.length}</span>
            </summary>
            <div className="disease-other-content" aria-labelledby="other-medicines-heading">
              <p className="disease-section-intro">These are different biomedical relationships and are not treatment recommendations.</p>
              {otherRelationTypes.length > 1 && (
                <div className="disease-relation-filters" aria-label="Filter other relationship types">
                  <button type="button" aria-pressed={otherRelationFilter === 'all'} onClick={() => setOtherRelationFilter('all')}>All</button>
                  {otherRelationTypes.map((relation) => (
                    <button type="button" key={relation} aria-pressed={otherRelationFilter === relation} onClick={() => setOtherRelationFilter(relation)}>{relationLabel(relation)}</button>
                  ))}
                </div>
              )}
              {visibleOther.length ? (
                <div className="disease-medicine-grid">
                  {visibleOther.map((item) => <MedicineRelationshipCard key={`${item.drug_id}-${item.relation}`} item={item} />)}
                </div>
              ) : (
                <div className="product-empty-state"><Info size={22} /><div><strong>No other typed medicine relationship is available.</strong></div></div>
              )}
            </div>
          </details>

          <aside className="medicine-source-boundary">
            <Search size={19} />
            <p>{payload.relationship_scope}</p>
            <Link className="product-inline-link" to="/methodology">Methodology <ExternalLink size={14} /></Link>
          </aside>
            </div>
          )}

          {activeSection === 'nutrition-lifestyle' && nutritionAvailable && (
            <DiseaseNutrition nutrition={nutrition} />
          )}

          <div className="disease-next-step">
            <div><strong>Have a medicine in mind?</strong><p>Open the medicine guide or check two medicines together.</p></div>
            <Link className="secondary-button" to="/medicines"><Pill size={16} /> Medicine guide</Link>
            <Link className="primary-button" to="/check"><Beaker size={16} /> Check medicines</Link>
          </div>
        </>
      )}
    </section>
  )
}
