import {
  AlertCircle,
  ArrowRight,
  Beaker,
  BookOpen,
  ExternalLink,
  FileText,
  Info,
  LoaderCircle,
  Network,
  Search,
  ShieldAlert,
  Utensils,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import MedicineLabelScanner from '../components/MedicineLabelScanner.jsx'
import { G3_CONTEXT_CANDIDATE_IDS } from '../data/g3ContextCandidateIds.js'
import { getJson } from '../lib/api.js'
import './PublicProduct.css'

const CONTEXT_IDS = new Set(G3_CONTEXT_CANDIDATE_IDS)
const SECTIONS = [
  ['overview', 'Overview'],
  ['uses', 'Uses'],
  ['side-effects', 'Side effects'],
  ['warnings', 'Warnings'],
  ['interactions', 'Interactions'],
  ['food-lifestyle', 'Food & lifestyle'],
  ['related-diseases', 'Related diseases'],
  ['sources', 'Sources'],
]
const LABEL_GROUPS = {
  uses: ['indications_and_usage'],
  'side-effects': ['adverse_reactions'],
  warnings: ['boxed_warning', 'warnings_and_cautions', 'warnings'],
  interactions: ['drug_interactions'],
}
const LABELS = {
  indications_and_usage: 'Indications and usage',
  adverse_reactions: 'Adverse reactions',
  boxed_warning: 'Boxed warning',
  warnings_and_cautions: 'Warnings and cautions',
  warnings: 'Warnings',
  drug_interactions: 'Drug interactions',
  dosage_and_administration: 'Dosage and administration',
  information_for_patients: 'Information for patients',
  patient_medication_information: 'Patient medication information',
  precautions: 'Precautions',
  general_precautions: 'General precautions',
}
const FOOD_TOPIC_LABELS = {
  alcohol: 'Alcohol',
  grapefruit: 'Grapefruit',
  vitamin_k: 'Vitamin K',
  food_or_meals: 'Food & meals',
  milk_or_dairy: 'Milk / dairy',
  high_fat_meal: 'High-fat meals',
  fasting_or_empty_stomach: 'Fasting / empty stomach',
  smoking_or_tobacco: 'Smoking / tobacco',
}
const PRODUCT_GROUPS = [
  ['single_ingredient', 'Single-ingredient products'],
  ['combination', 'Combination products containing this medicine'],
  ['unknown', 'Other or uncertain products'],
]
const MEDICINE_EXAMPLES = [
  { name: 'Metformin', id: 'DB00331' },
  { name: 'Warfarin', id: 'DB00682' },
  { name: 'Ibuprofen', id: 'DB01050' },
]

function productClassification(record) {
  return record.product_classification || {
    category: 'unknown',
    label: 'Product type not confirmed',
    active_ingredients: record.product_metadata?.substance_name || [],
  }
}

function productName(record, index = 0) {
  return record.product_name
    || record.product_metadata?.brand_name?.[0]
    || record.product_metadata?.generic_name?.[0]
    || `Label record ${index + 1}`
}

function sectionEntries(labelInformation, sectionKey) {
  const wanted = new Set(LABEL_GROUPS[sectionKey] || [])
  const entries = []
  for (const [recordIndex, record] of (labelInformation?.records || []).entries()) {
    for (const [section, values] of Object.entries(record.sections || {})) {
      if (!wanted.has(section)) continue
      for (const [valueIndex, value] of values.entries()) {
        entries.push({ ...value, section, record, recordIndex, valueIndex })
      }
    }
  }
  return entries
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'api.fda.gov' ? url.href : null
  } catch {
    return null
  }
}

function foodProductClassification(item) {
  const category = item.product_classification || 'unknown'
  const fallbackLabels = {
    single_ingredient: 'Single-ingredient / direct medicine product',
    combination: 'Combination product',
    unknown: 'Product type not confirmed',
  }
  return {
    category,
    label: item.product_classification_label || fallbackLabels[category] || fallbackLabels.unknown,
  }
}

function foodLifestyleGroups(foodLifestyleInformation) {
  const groups = new Map()
  for (const item of foodLifestyleInformation?.topics || []) {
    if (!FOOD_TOPIC_LABELS[item.topic]) continue
    if (!groups.has(item.topic)) groups.set(item.topic, [])
    groups.get(item.topic).push(item)
  }
  return [...groups.entries()]
}

function MedicineLanding({ onSelect }) {
  return (
    <section className="page product-page medicine-guide-page">
      <header className="product-page-header">
        <span className="eyebrow">Medicine guide</span>
        <h1>Explore a medicine</h1>
        <p>Find available uses, side effects, warnings, interactions, and related conditions.</p>
      </header>
      <div className="product-input-panel medicine-landing-search">
        <DrugAutocomplete label="Medicine" selection={null} onSelect={onSelect} />
        <div className="medicine-landing-secondary">
          <MedicineLabelScanner targetLabel="Medicine" onDrugSelect={onSelect} />
        </div>
        <div className="product-example-row">
          <span>Try an example</span>
          <div className="product-example-chips">
            {MEDICINE_EXAMPLES.map((item) => (
              <Link key={item.id} to={`/medicines/${item.id}`}>{item.name}</Link>
            ))}
          </div>
        </div>
        <div className="product-entry-capabilities" aria-label="Available medicine information">
          {['Uses', 'Side effects', 'Warnings', 'Interactions', 'Related conditions'].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

function LabelSection({ labelInformation, sectionKey }) {
  const entries = sectionEntries(labelInformation, sectionKey)
  const title = SECTIONS.find(([key]) => key === sectionKey)?.[1] || 'Label information'
  const [expanded, setExpanded] = useState({})

  return (
    <section className="medicine-content-panel" aria-labelledby={`medicine-${sectionKey}-heading`}>
      <div className="medicine-content-heading">
        <span className="public-quick-icon"><FileText size={20} /></span>
        <div><span className="eyebrow">Official label text</span><h2 id={`medicine-${sectionKey}-heading`}>{title}</h2></div>
      </div>
      {entries.length ? (
        <div className="medicine-label-entries">
          {entries.map((entry) => {
            const entryKey = `${entry.recordIndex}-${entry.section}-${entry.valueIndex}`
            const classification = productClassification(entry.record)
            const ingredients = classification.active_ingredients || []
            const isExpanded = Boolean(expanded[entryKey])
            return (
              <article className="medicine-label-entry" key={entryKey}>
                <header className="medicine-label-record-heading">
                  <div>
                    <span className={`medicine-product-badge is-${classification.category}`}>{classification.label}</span>
                    <h3>{productName(entry.record, entry.recordIndex)}</h3>
                  </div>
                  <span className="medicine-source-badge">openFDA</span>
                </header>
                <div className="medicine-label-section-meta">
                  <strong>{LABELS[entry.section] || entry.section}</strong>
                  <small>{entry.record.spl_set_id ? `SPL ${entry.record.spl_set_id}` : `Label record ${entry.recordIndex + 1}`}</small>
                </div>
                {ingredients.length > 0 && (
                  <p className="medicine-ingredient-line"><strong>Active ingredients:</strong> {ingredients.join(', ')}</p>
                )}
                <p className={`medicine-label-text ${isExpanded ? '' : 'is-clamped'}`}>
                  {entry.text}{entry.truncated ? ' …' : ''}
                </p>
                <button
                  type="button"
                  className="product-inline-button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded((current) => ({ ...current, [entryKey]: !current[entryKey] }))}
                >
                  {isExpanded ? 'Show less' : 'View full label text'}
                </button>
                {entry.truncated && <small className="product-count-note">This long section is shortened in CHEERS; open the source query for the complete record.</small>}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="product-card-empty medicine-section-empty">
          <strong>No {title.toLowerCase()} section was retrieved.</strong>
          <p>The current checked label records do not contain this section. This is not a medical conclusion.</p>
        </div>
      )}
    </section>
  )
}

function FoodLifestyleSection({ labelInformation }) {
  const information = labelInformation?.food_lifestyle_information
  const status = information?.status || 'unavailable'
  const groups = foodLifestyleGroups(information)

  return (
    <section className="medicine-content-panel" aria-labelledby="medicine-food-lifestyle-heading">
      <div className="medicine-content-heading">
        <span className="public-quick-icon"><Utensils size={20} /></span>
        <div>
          <span className="eyebrow">Official label excerpts</span>
          <h2 id="medicine-food-lifestyle-heading">Food & lifestyle</h2>
        </div>
      </div>

      {status === 'available' && groups.length > 0 && (
        <>
          <p className="medicine-food-intro">
            These excerpts retain their label section and product identity. A
            combination-product excerpt is not attributed to the selected ingredient alone.
          </p>
          <div className="medicine-food-topic-list">
            {groups.map(([topic, items]) => (
              <section className="medicine-food-topic" key={topic} aria-labelledby={`medicine-food-${topic}`}>
                <div className="medicine-food-topic-heading">
                  <h3 id={`medicine-food-${topic}`}>{FOOD_TOPIC_LABELS[topic]}</h3>
                  <span>{items.length} {items.length === 1 ? 'source excerpt' : 'source excerpts'}</span>
                </div>
                <div className="medicine-label-entries">
                  {items.map((item, index) => {
                    const classification = foodProductClassification(item)
                    const sourceId = item.source_id || item.spl_set_id || item.application_number
                    const sourceUrl = safeSourceUrl(labelInformation?.query_url || item.source_url)
                    return (
                      <article
                        className="medicine-label-entry medicine-food-item"
                        key={`${topic}-${sourceId || item.product_name || 'record'}-${item.section}-${index}`}
                      >
                        <header className="medicine-label-record-heading">
                          <div>
                            <span className={`medicine-product-badge is-${classification.category}`}>{classification.label}</span>
                            <h4>{item.product_name || 'Label product'}</h4>
                          </div>
                          <span className="medicine-source-badge">{item.source || 'openFDA'}</span>
                        </header>
                        <div className="medicine-label-section-meta">
                          <strong>{LABELS[item.section] || item.section}</strong>
                          <small>{sourceId ? `Source ID ${sourceId}` : 'Source record ID not provided'}</small>
                        </div>
                        {item.active_ingredients?.length > 0 && (
                          <p className="medicine-ingredient-line">
                            <strong>Active ingredients:</strong> {item.active_ingredients.join(', ')}
                          </p>
                        )}
                        <p className="medicine-label-text">{item.excerpt}</p>
                        {sourceUrl && (
                          <a className="product-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
                            Open the openFDA source <ExternalLink size={14} />
                          </a>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {status === 'no_explicit_mentions' && (
        <div className="product-card-empty medicine-section-empty">
          <strong>No explicit food or lifestyle information was retrieved from the checked label records.</strong>
          <p>This does not mean there is no interaction or concern.</p>
        </div>
      )}

      {status === 'unavailable' && (
        <div className="product-card-empty medicine-section-empty">
          <strong>Food and lifestyle label information is unavailable.</strong>
          <p>The official label source could not be checked. No medical conclusion has been generated.</p>
        </div>
      )}

      {status === 'available' && groups.length === 0 && (
        <div className="product-card-empty medicine-section-empty">
          <strong>Food and lifestyle source details could not be displayed.</strong>
          <p>No medical conclusion has been generated.</p>
        </div>
      )}
    </section>
  )
}

function RelatedDiseases({ context, contextError }) {
  const relationships = context?.context?.disease?.relationships || []
  return (
    <section className="medicine-content-panel" aria-labelledby="related-diseases-heading">
      <div className="medicine-content-heading">
        <span className="public-quick-icon"><Network size={20} /></span>
        <div><span className="eyebrow">Related information</span><h2 id="related-diseases-heading">Related diseases</h2></div>
      </div>
      {relationships.length ? (
        <div className="medicine-related-list">
          {relationships.slice(0, 20).map((item) => (
            <article key={`${item.context_node_id}-${item.relation}`}>
              <div><strong>{item.context_name}</strong><small>{String(item.relation).replaceAll('_', ' ')}</small></div>
              <Link to={`/diseases/${encodeURIComponent(item.context_id)}`}>View disease <ArrowRight size={14} /></Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="product-card-empty medicine-section-empty">
          <strong>Related disease context is not available.</strong>
          <p>{contextError || 'No disease connections are available in the current knowledge-graph data for this medicine. This does not mean no relationship exists.'}</p>
        </div>
      )}
    </section>
  )
}

function SourceRecords({ labelInformation }) {
  const sourceUrl = safeSourceUrl(labelInformation?.query_url)
  const records = labelInformation?.records || []
  return (
    <section className="medicine-content-panel" aria-labelledby="medicine-sources-heading">
      <div className="medicine-content-heading">
        <span className="public-quick-icon"><BookOpen size={20} /></span>
        <div><span className="eyebrow">Source details</span><h2 id="medicine-sources-heading">Official label records</h2></div>
      </div>
      <div className="medicine-source-groups">
        {PRODUCT_GROUPS.map(([category, heading]) => {
          const groupRecords = records.filter((record) => productClassification(record).category === category)
          if (!groupRecords.length) return null
          return (
            <section className="medicine-source-group" key={category}>
              <div className="medicine-source-group-heading"><h3>{heading}</h3><span>{groupRecords.length}</span></div>
              <div className="medicine-source-records">
                {groupRecords.map((record, index) => {
                  const classification = productClassification(record)
                  const ingredients = classification.active_ingredients || []
                  return (
                    <article key={`${record.spl_set_id || 'record'}-${index}`}>
                      <span className={`medicine-product-badge is-${classification.category}`}>{classification.label}</span>
                      <strong>{productName(record, index)}</strong>
                      {ingredients.length > 0 && <p className="medicine-source-ingredients"><b>Active ingredients:</b> {ingredients.join(', ')}</p>}
                      <dl>
                        <div><dt>Manufacturer</dt><dd>{record.product_metadata?.manufacturer_name?.[0] || 'Not provided'}</dd></div>
                        <div><dt>Effective date</dt><dd>{record.effective_time || 'Not provided'}</dd></div>
                        <div><dt>SPL Set ID</dt><dd>{record.spl_set_id || 'Not provided'}</dd></div>
                        <div><dt>Application</dt><dd>{record.application_number || 'Not provided'}</dd></div>
                      </dl>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
      {sourceUrl && <a className="product-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">Open the openFDA source query <ExternalLink size={14} /></a>}
    </section>
  )
}

function MedicineOverview({ drugId, labelInformation, context }) {
  const availableSections = new Set(labelInformation?.available_sections || [])
  const foodLifestyleInformation = labelInformation?.food_lifestyle_information
  const modules = [
    ['uses', 'Uses', availableSections.has('indications_and_usage'), FileText],
    ['side-effects', 'Side effects', availableSections.has('adverse_reactions'), Info],
    ['warnings', 'Warnings', ['boxed_warning', 'warnings_and_cautions', 'warnings'].some((item) => availableSections.has(item)), ShieldAlert],
    ['interactions', 'Interactions', availableSections.has('drug_interactions'), Beaker],
    ['related-diseases', 'Related diseases', Boolean(context?.context?.disease?.relationships?.length), Network],
    ['sources', 'Sources', Boolean(labelInformation?.records?.length), BookOpen],
  ]
  if (foodLifestyleInformation) {
    const available = foodLifestyleInformation.status === 'available'
    const statusLabel = {
      available: 'Available',
      no_explicit_mentions: 'No explicit mention',
      unavailable: 'Source unavailable',
    }[foodLifestyleInformation.status] || 'Source unavailable'
    modules.splice(4, 0, ['food-lifestyle', 'Food & lifestyle', available, Utensils, statusLabel])
  }

  return (
    <section className="medicine-at-a-glance" aria-labelledby="medicine-glance-heading">
      <div className="medicine-content-heading">
        <span className="public-quick-icon"><FileText size={20} /></span>
        <div><span className="eyebrow">Available information</span><h2 id="medicine-glance-heading">At a glance</h2></div>
      </div>
      <div className="medicine-module-grid">
        {modules.map(([key, label, available, Icon, statusLabel]) => (
          <Link
            aria-label={`${label}: ${statusLabel || (available ? 'Available' : 'No section retrieved')}`}
            className={available ? 'is-available' : 'is-unavailable'}
            key={key}
            to={`/medicines/${encodeURIComponent(drugId)}?section=${key}`}
          >
            <Icon size={18} aria-hidden="true" />
            <strong>{label}</strong>
            <span>{statusLabel || (available ? 'Available' : 'No section retrieved')}</span>
          </Link>
        ))}
      </div>
      <p className="medicine-overview-meta">
        {labelInformation.records_examined} label {labelInformation.records_examined === 1 ? 'record' : 'records'} reviewed · {labelInformation.available_sections.length} label sections available
      </p>
    </section>
  )
}

export default function MedicineGuide() {
  const navigate = useNavigate()
  const { drugId } = useParams()
  const [searchParams] = useSearchParams()
  const requestedSection = searchParams.get('section') || 'overview'
  const activeSection = SECTIONS.some(([key]) => key === requestedSection) ? requestedSection : 'overview'
  const [request, setRequest] = useState({ drugId: '', payload: null, context: null, error: '', contextError: '' })
  const requestIsCurrent = request.drugId === drugId
  const payload = requestIsCurrent ? request.payload : null
  const context = requestIsCurrent ? request.context : null
  const error = requestIsCurrent ? request.error : ''
  const contextError = requestIsCurrent ? request.contextError : ''
  const loading = Boolean(drugId) && !requestIsCurrent

  useEffect(() => {
    if (!drugId) return undefined
    let active = true
    const contextSupported = CONTEXT_IDS.has(drugId.toUpperCase())
    Promise.allSettled([
      getJson(`/api/public/medicine?drug_id=${encodeURIComponent(drugId)}`),
      contextSupported
        ? getJson(`/api/context/drug?drug_id=${encodeURIComponent(drugId)}`)
        : Promise.resolve(null),
    ]).then(([medicineResult, contextResult]) => {
      if (!active) return
      setRequest({
        drugId,
        payload: medicineResult.status === 'fulfilled' ? medicineResult.value : null,
        context: contextResult.status === 'fulfilled' ? contextResult.value : null,
        error: medicineResult.status === 'rejected'
          ? medicineResult.reason?.message || 'Medicine information could not be loaded.'
          : '',
        contextError: contextResult.status === 'rejected'
          ? contextResult.reason?.message || 'Related disease context could not be loaded.'
          : '',
      })
    })
    return () => {
      active = false
    }
  }, [drugId])

  if (!drugId) {
    return <MedicineLanding onSelect={(drug) => navigate(`/medicines/${encodeURIComponent(drug.entity_id)}`)} />
  }

  const drug = payload?.drug
  const labelInformation = payload?.label_information
  const labelStatus = labelInformation?.status

  return (
    <section className="page product-page medicine-profile-page">
      <header className="medicine-profile-header">
        <div>
          <Link className="product-back-link" to="/medicines">← Medicine guide</Link>
          <span className="eyebrow">Medicine profile</span>
          <h1>{drug?.drug_name || 'Medicine information'}</h1>
          <p><span>DrugBank ID</span> {drug?.drug_id || drugId}</p>
        </div>
        {drug && (
          <div className="medicine-header-actions">
            <Link className="primary-button" to={`/check?drug_a_id=${encodeURIComponent(drug.drug_id)}`}><Beaker size={17} /> Check with another medicine</Link>
            <Link className="secondary-button" to="/subgraph"><Network size={17} /> Explore graph</Link>
          </div>
        )}
      </header>

      {loading && <div className="product-empty-state" role="status"><LoaderCircle className="spin" size={24} /><div><strong>Loading medicine sources…</strong></div></div>}
      {error && <div className="product-source-error" role="alert"><AlertCircle size={20} /><span>{error}</span></div>}

      {!loading && !error && payload && (
        <>
          <nav className="medicine-section-nav" aria-label="Medicine information sections">
            {SECTIONS.map(([key, label]) => (
              <Link
                key={key}
                className={activeSection === key ? 'active' : ''}
                aria-current={activeSection === key ? 'page' : undefined}
                to={`/medicines/${encodeURIComponent(drugId)}${key === 'overview' ? '' : `?section=${key}`}`}
              >
                {label}
              </Link>
            ))}
          </nav>

          {labelStatus === 'error' && activeSection !== 'food-lifestyle' && (
            <div className="product-source-error" role="alert"><AlertCircle size={20} /><span>{labelInformation.error || 'openFDA label information is unavailable.'}</span></div>
          )}
          {labelStatus === 'no_matches' && !['food-lifestyle', 'related-diseases'].includes(activeSection) && (
            <div className="product-empty-state"><Info size={24} /><div><strong>No openFDA label record was retrieved.</strong><p>This does not mean the medicine has no uses, side effects, warnings, or interactions.</p></div></div>
          )}

          {activeSection === 'overview' && labelStatus === 'ok' && (
            <MedicineOverview drugId={drugId} labelInformation={labelInformation} context={context} />
          )}
          {LABEL_GROUPS[activeSection] && labelStatus === 'ok' && <LabelSection labelInformation={labelInformation} sectionKey={activeSection} />}
          {activeSection === 'food-lifestyle' && <FoodLifestyleSection labelInformation={labelInformation} />}
          {activeSection === 'related-diseases' && <RelatedDiseases context={context} contextError={contextError} />}
          {activeSection === 'sources' && labelStatus === 'ok' && <SourceRecords labelInformation={labelInformation} />}

          <aside className="medicine-source-boundary">
            <Search size={19} />
            <p>{payload.safety_note || 'Official label information is presented for source review, not personalized medical advice.'}</p>
          </aside>
        </>
      )}
    </section>
  )
}
