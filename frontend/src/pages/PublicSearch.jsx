import {
  AlertCircle,
  ArrowRight,
  Beaker,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Info,
  LoaderCircle,
  Network,
  Pill,
  Search,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PublicSearchBox from '../components/PublicSearchBox.jsx'
import { getJson } from '../lib/api.js'
import { publicSearchDestination } from '../lib/publicSearchRouting.js'
import './PublicSearch.css'

const INTENT_LABELS = {
  disease_information: 'Disease information',
  drug_information: 'Medicine information',
  drug_side_effects: 'Medicine side effects',
  drug_interactions: 'Medicine interactions',
  drug_food_lifestyle: 'Medicine food & lifestyle information',
  drug_pair: 'Medicine pair',
  drug_pair_question: 'Medicine-pair question',
  drug_for_disease: 'Medicine and condition question',
  medicines_for_disease: 'Medicines linked to a condition',
  disease_nutrition: 'Disease nutrition information',
  unsupported: 'Recognized request',
  unknown: 'Search not recognized',
}

const MODULE_LABELS = {
  disease_explanation: 'Disease explanation',
  drug_explanation: 'General medicine explanation',
  drug_side_effects: 'Medicine side-effect information',
  single_drug_label_interactions: 'Single-medicine label interactions',
  drug_food_lifestyle_information: 'Food & lifestyle label information',
  pair_external_evidence: 'Medicine-pair source information',
  pair_graph_context: 'Shared biomedical graph context',
  research_graph_context: 'Biomedical graph context',
  drug_disease_relationship_answer: 'Medicine and condition answer',
  disease_indication_medicines_answer: 'Condition indication medicines',
  disease_nutrition_information: 'Disease nutrition information',
  drug_pair_question_answer: 'Medicine-pair answer',
  query_resolution: 'Search recognition',
}

const FOOD_LIFESTYLE_TOPIC_LABELS = {
  alcohol: 'Alcohol information',
  grapefruit: 'Grapefruit information',
  vitamin_k: 'Vitamin K information',
  food_or_meals: 'Food & meal information',
  milk_or_dairy: 'Milk / dairy information',
  high_fat_meal: 'High-fat meal information',
  fasting_or_empty_stomach: 'Fasting / empty stomach information',
  smoking_or_tobacco: 'Smoking / tobacco information',
}

const NATURAL_QUESTION_EXAMPLES = [
  'Can I take warfarin with ibuprofen?',
  'Is metformin used for type 2 diabetes mellitus?',
  'What medicines are used for type 2 diabetes mellitus?',
  'Metformin side effects',
]

const DESTINATION_DETAILS = {
  pair_external_evidence: {
    title: 'Review medicine-pair sources',
    description: 'Open independent openFDA and PubMed information retrieved for this pair.',
    icon: Beaker,
  },
  pair_graph_context: {
    title: 'Explore shared biomedical connections',
    description: 'View available gene/protein and disease relationships in the knowledge graph.',
    icon: Network,
  },
}

function entityLabel(entity) {
  return entity.entity_type === 'disease' ? 'Disease' : 'Medicine'
}

function sentenceCase(value) {
  const text = String(value || '')
  return text ? `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}` : text
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceAmbiguousFragment(query, fragment, replacement) {
  const pattern = new RegExp(`\\b${escapeRegExp(fragment)}\\b`, 'i')
  return pattern.test(query) ? query.replace(pattern, replacement) : replacement
}

function EntityCard({ entity }) {
  const isDisease = entity.entity_type === 'disease'
  const Icon = isDisease ? GitBranch : Pill

  return (
    <article className="public-entity-card">
      <span className="public-entity-icon"><Icon size={20} /></span>
      <div>
        <span className="public-entity-type">{entityLabel(entity)}</span>
        <h3>{entity.name}</h3>
        <p>{entity.entity_id}</p>
      </div>
      <span className="public-recognized-badge">
        <CheckCircle2 size={14} /> Recognized
      </span>
    </article>
  )
}

function DiseaseExplanation({ entity }) {
  if (!entity.verified_description_available) {
    return (
      <section className="public-neutral-state" aria-labelledby="disease-explanation-unavailable">
        <BookOpen size={21} aria-hidden="true" />
        <div>
          <h2 id="disease-explanation-unavailable">Verified explanation unavailable</h2>
          <p>
            CHEERS recognizes this disease, but its current description is not approved
            for presentation. No explanation has been generated to fill the gap.
          </p>
        </div>
      </section>
    )
  }

  const provenance = entity.description_provenance
  return (
    <section className="public-answer-card" aria-labelledby="disease-explanation-title">
      <span className="eyebrow">Approved disease description</span>
      <h2 id="disease-explanation-title">About {entity.name}</h2>
      <p className="public-answer-text">{entity.description}</p>
      {provenance && (
        <p className="public-provenance">
          Source: {provenance.source}
          {provenance.source_id ? ` · ${provenance.source_id}` : ''}
          {provenance.license ? ` · ${provenance.license}` : ''}
        </p>
      )}
    </section>
  )
}

function DrugInformationState({ entity }) {
  return (
    <section className="public-neutral-state" aria-labelledby="drug-information-status">
      <BookOpen size={21} aria-hidden="true" />
      <div>
        <h2 id="drug-information-status">Medicine information available</h2>
        <p>
          CHEERS recognized {entity.name} ({entity.entity_id}). Open its medicine
          profile to review available official label information and related connections.
        </p>
        <Link className="text-action" to={`/medicines/${encodeURIComponent(entity.entity_id)}`}>Open medicine profile <ArrowRight size={16} /></Link>
      </div>
    </section>
  )
}

function SingleDrugTopicState({ intent, entity }) {
  const isSideEffects = intent === 'drug_side_effects'
  return (
    <section className="public-neutral-state" aria-labelledby="single-drug-topic-status">
      <BookOpen size={21} aria-hidden="true" />
      <div>
        <h2 id="single-drug-topic-status">
          {isSideEffects ? 'Review available side-effect information' : 'Review available interaction information'}
        </h2>
        <p>
          CHEERS recognized {entity.name}. Its medicine profile shows any matching
          official label sections without generating a medical conclusion.
        </p>
        <Link className="text-action" to={`/medicines/${encodeURIComponent(entity.entity_id)}?section=${isSideEffects ? 'side-effects' : 'interactions'}`}>
          Open medicine profile <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  )
}

function FoodLifestyleSearchState({ data, entity, status }) {
  const topicLabel = FOOD_LIFESTYLE_TOPIC_LABELS[data.topic]
    || data.topic_label
    || 'Food & lifestyle information'
  const copy = {
    available: 'CHEERS found food/lifestyle label information for this medicine.',
    no_explicit_mentions: 'No explicit mention was retrieved in the checked label records.',
    unavailable: 'The official label source is unavailable, so CHEERS could not check this topic.',
  }[status] || 'The official label source is unavailable, so CHEERS could not check this topic.'

  return (
    <section className={`public-direct-answer ${status === 'available' ? 'is-related' : 'is-neutral'}`} aria-labelledby="food-lifestyle-search-title">
      <div className="public-direct-answer-heading">
        <span className="public-direct-answer-icon"><BookOpen size={22} aria-hidden="true" /></span>
        <div>
          <span className="public-answer-status-label">Food & lifestyle label information</span>
          <h2 id="food-lifestyle-search-title">{entity.name}</h2>
        </div>
      </div>
      <p className="public-direct-answer-copy">{copy}</p>
      <div className="public-answer-facts" aria-label="Resolved medicine and topic">
        <div><span>Medicine</span><strong>{entity.name}</strong></div>
        <div><span>Topic</span><strong>{topicLabel}</strong></div>
      </div>
      <Link className="public-view-all-medicines" to={`/medicines/${encodeURIComponent(entity.entity_id)}?section=food-lifestyle`}>
        View Food & lifestyle information <ArrowRight size={17} aria-hidden="true" />
      </Link>
      {status === 'no_explicit_mentions' && (
        <div className="public-answer-boundary">
          <p>This does not mean there is no interaction or concern.</p>
        </div>
      )}
    </section>
  )
}

function DiseaseNutritionSearchState({ answer, disease }) {
  if (!answer || !disease) return null
  const available = answer.availability === true
  const destination = answer.destination
    || `/diseases/${encodeURIComponent(disease.entity_id)}`

  return (
    <section className={`public-direct-answer ${available ? 'is-related' : 'is-neutral'}`} aria-labelledby="disease-nutrition-search-title">
      <div className="public-direct-answer-heading">
        <span className="public-direct-answer-icon"><BookOpen size={22} aria-hidden="true" /></span>
        <div>
          <span className="public-answer-status-label">
            {available ? 'Nutrition information available' : 'Nutrition information unavailable'}
          </span>
          <h2 id="disease-nutrition-search-title">{sentenceCase(disease.name)}</h2>
        </div>
      </div>
      <p className="public-direct-answer-copy">{answer.message}</p>
      <div className="public-answer-facts" aria-label="Resolved disease and topic">
        <div><span>Disease</span><strong>{sentenceCase(disease.name)}</strong></div>
        <div><span>Topic</span><strong>Nutrition &amp; lifestyle</strong></div>
        {available && answer.source_organization && (
          <div><span>Reviewed source</span><strong>{answer.source_organization}</strong></div>
        )}
      </div>
      <Link className="public-view-all-medicines" to={destination}>
        {available ? 'View Nutrition & lifestyle' : 'View disease information'}
        <ArrowRight size={17} aria-hidden="true" />
      </Link>
    </section>
  )
}

function DrugDiseaseAnswer({ answer }) {
  if (!answer?.drug || !answer?.disease) return null
  const { drug, disease } = answer
  const relationships = [...new Set(
    (answer.relationships || []).map((item) => item.relation).filter(Boolean),
  )]
  const states = {
    indication_found: {
      tone: 'indication',
      label: 'Yes',
      title: 'Treatment indication found',
      Icon: CheckCircle2,
      explanation: `${drug.name} has an indication relationship with ${sentenceCase(disease.name)} in the CHEERS checked data.`,
    },
    other_relationship_found: {
      tone: 'related',
      label: 'Related, but not a standard indication',
      title: answer.direct_answer,
      Icon: Info,
      explanation: 'CHEERS found a different biomedical relationship between this medicine and condition.',
    },
    no_indication_found: {
      tone: 'neutral',
      label: 'No indication found',
      title: 'No treatment indication found',
      Icon: Info,
      explanation: `CHEERS did not find a treatment-indication relationship between ${drug.name} and ${sentenceCase(disease.name)} in the checked data.`,
    },
    insufficient_data: {
      tone: 'neutral',
      label: 'Not enough information',
      title: answer.direct_answer,
      Icon: Info,
      explanation: answer.source_scope,
    },
  }
  const state = states[answer.answer_type]
  if (!state) return null
  const Icon = state.Icon

  return (
    <section className={`public-direct-answer is-${state.tone}`} aria-labelledby="drug-disease-answer-title">
      <div className="public-direct-answer-heading">
        <span className="public-direct-answer-icon"><Icon size={22} aria-hidden="true" /></span>
        <div>
          <span className="public-answer-status-label">{state.label}</span>
          <h2 id="drug-disease-answer-title">{state.title}</h2>
        </div>
      </div>
      <p className="public-direct-answer-copy">{state.explanation}</p>
      <div className="public-answer-facts" aria-label="Resolved medicine and condition">
        <div><span>Medicine</span><strong>{drug.name}</strong></div>
        <div><span>Condition</span><strong>{sentenceCase(disease.name)}</strong></div>
        {relationships.length > 0 && (
          <div><span>Relationship</span><strong>{relationships.map(sentenceCase).join(', ')}</strong></div>
        )}
      </div>
      <div className="public-answer-actions" aria-label="Medicine and condition actions">
        <Link to={`/medicines/${encodeURIComponent(drug.entity_id)}`}>View {drug.name}</Link>
        <Link to={`/diseases/${encodeURIComponent(disease.entity_id)}`}>View {sentenceCase(disease.name)}</Link>
        <Link to={`/check?drug_a_id=${encodeURIComponent(drug.entity_id)}`}>Check {drug.name} with another medicine</Link>
      </div>
      {(answer.source_scope || answer.safety_note) && (
        <div className="public-answer-boundary">
          {answer.source_scope && <p>{answer.source_scope}</p>}
          {answer.safety_note && <p>{answer.safety_note}</p>}
        </div>
      )}
    </section>
  )
}

function PairQuestionAnswer({ answer }) {
  if (!answer?.drug_1 || !answer?.drug_2) return null
  const states = {
    interaction_warning_found: { tone: 'warning', Icon: AlertCircle },
    needs_review: { tone: 'review', Icon: BookOpen },
    insufficient_information: { tone: 'neutral', Icon: Info },
  }
  const state = states[answer.answer_type]
  if (!state) return null
  const Icon = state.Icon
  const counts = answer.evidence_summary || {}

  return (
    <section className={`public-direct-answer is-${state.tone}`} aria-labelledby="pair-question-answer-title">
      <div className="public-direct-answer-heading">
        <span className="public-direct-answer-icon"><Icon size={22} aria-hidden="true" /></span>
        <div>
          <span className="public-answer-status-label">{answer.direct_answer}</span>
          <h2 id="pair-question-answer-title">{answer.drug_1.name} + {answer.drug_2.name}</h2>
        </div>
      </div>
      {answer.supporting_text && <p className="public-direct-answer-copy">{answer.supporting_text}</p>}
      <div className="public-answer-facts public-evidence-counts" aria-label="Retrieved source counts">
        {Number.isFinite(counts.label_mentions) && (
          <div><span>FDA label mentions</span><strong>{counts.label_mentions}</strong></div>
        )}
        {Number.isFinite(counts.pubmed_records) && (
          <div><span>PubMed records</span><strong>{counts.pubmed_records}</strong></div>
        )}
      </div>
      {(answer.source_scope || answer.safety_note) && (
        <div className="public-answer-boundary">
          {answer.source_scope && <p>{answer.source_scope}</p>}
          {answer.safety_note && <p>{answer.safety_note}</p>}
        </div>
      )}
    </section>
  )
}

function MedicinesForDiseaseState({ answer, disease: recognizedDisease }) {
  const disease = answer?.disease || recognizedDisease
  if (!disease || !answer) return null
  const medicines = (answer.medicines || [])
    .filter((item) => item.relation === 'indication')
    .slice(0, 6)
  const hasMedicines = answer.answer_type === 'indication_medicines_found'

  return (
    <section className={`public-direct-answer ${hasMedicines ? 'is-indication' : 'is-neutral'}`} aria-labelledby="medicines-for-disease-title">
      <div className="public-direct-answer-heading">
        <span className="public-direct-answer-icon">
          {hasMedicines ? <CheckCircle2 size={22} aria-hidden="true" /> : <Info size={22} aria-hidden="true" />}
        </span>
        <div>
          <span className="public-answer-status-label">{answer.direct_answer}</span>
          <h2 id="medicines-for-disease-title">{sentenceCase(disease.name)}</h2>
        </div>
      </div>
      {hasMedicines ? (
        <p className="public-direct-answer-copy">
          CHEERS found these medicines with indication relationships for this condition in the checked data.
        </p>
      ) : (
        <p className="public-direct-answer-copy">
          {answer.answer_type === 'insufficient_data'
            ? 'CHEERS could not reliably check indication relationships for this condition.'
            : 'CHEERS did not find medicines with indication relationships for this condition in the checked data.'}
        </p>
      )}

      {hasMedicines && (
        <>
          <p className="public-medicine-count"><strong>{answer.total_count}</strong> indication medicines found</p>
          <div className="public-medicine-answer-list" aria-label="Indication medicines">
            {medicines.map((medicine) => (
              <article className="public-medicine-answer-item" key={medicine.drug_id}>
                <div>
                  <span>Indication</span>
                  <h3>{medicine.drug_name}</h3>
                  <p>{medicine.drug_id}</p>
                </div>
                <div className="public-medicine-answer-actions">
                  <Link to={`/medicines/${encodeURIComponent(medicine.drug_id)}`}>View medicine</Link>
                  <Link to={`/medicines/${encodeURIComponent(medicine.drug_id)}?section=side-effects`}>Side effects</Link>
                  <Link to={`/check?drug_a_id=${encodeURIComponent(medicine.drug_id)}`}>Check interactions</Link>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <Link className="public-view-all-medicines" to={`/diseases/${encodeURIComponent(disease.entity_id)}`}>
        {hasMedicines ? `View all ${answer.total_count} medicines` : 'Open Disease Guide'}
        <ArrowRight size={17} aria-hidden="true" />
      </Link>

      {(answer.source_scope || answer.safety_note) && (
        <div className="public-answer-boundary">
          {answer.source_scope && <p>{answer.source_scope}</p>}
          {answer.safety_note && <p>{answer.safety_note}</p>}
        </div>
      )}
    </section>
  )
}

function PairDestinations({ data, includeChecker = false }) {
  const destinations = data.destinations?.filter((item) => item.frontend_path) || []
  const entities = data.recognized_entities || []
  const checkerParams = entities.length === 2
    ? new URLSearchParams({
        drug_a_id: entities[0].entity_id,
        drug_b_id: entities[1].entity_id,
      }).toString()
    : ''

  return (
    <section className="public-next-steps" aria-labelledby="pair-next-steps-title">
      <div className="public-section-heading">
        <span className="eyebrow">Available next steps</span>
        <h2 id="pair-next-steps-title">Choose how deeply you want to explore</h2>
      </div>
      <div className="public-destination-grid">
        {includeChecker && checkerParams && (
          <Link to={`/check?${checkerParams}`} className="public-destination-card">
            <span><Pill size={20} /></span>
            <div>
              <h3>Open Medicine Checker</h3>
              <p>Review the same pair with its source details and available context.</p>
            </div>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        )}
        {destinations.map((destination) => {
          const detail = DESTINATION_DETAILS[destination.module]
          if (!detail) return null
          const Icon = detail.icon
          return (
            <Link key={destination.module} to={destination.frontend_path} className="public-destination-card">
              <span><Icon size={20} /></span>
              <div>
                <h3>{detail.title}</h3>
                <p>{detail.description}</p>
              </div>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          )
        })}
        <Link to="/predictor" className="public-destination-card public-research-destination">
          <span><Search size={20} /></span>
          <div>
            <h3>Open the research DDI Predictor</h3>
            <p>Use the R-GCN ranking tool as a separate research view.</p>
          </div>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </div>
      <p className="public-context-boundary">
        Source information and graph context are independent of the R-GCN score.
        They do not explain or clinically validate a model prediction.
      </p>
    </section>
  )
}

function UnavailableModules({ modules, intent }) {
  if (!modules?.length) return null
  const describedAbove = new Set([
    'disease_explanation',
    'drug_explanation',
    'drug_side_effects',
    'single_drug_label_interactions',
    'drug_disease_relationship_answer',
    'disease_indication_medicines_answer',
    'disease_nutrition_information',
    'drug_pair_question_answer',
  ])
  const visibleModules = modules.filter((item) => (
    !describedAbove.has(item.module)
    && (item.module !== 'query_resolution' || intent === 'unsupported')
  ))
  if (!visibleModules.length) return null

  return (
    <section className="public-unavailable" aria-labelledby="unavailable-title">
      <h2 id="unavailable-title">Information not available in this search</h2>
      {visibleModules.map((item) => (
        <div key={`${item.module}-${item.reason}`}>
          <strong>{MODULE_LABELS[item.module] || item.module}</strong>
          <p>{item.reason}</p>
        </div>
      ))}
      <p className="public-unavailable-boundary">
        Missing information does not mean safety, no interaction, or no biomedical relationships.
      </p>
    </section>
  )
}

function AmbiguousState({ data, onChoose }) {
  return (
    <section className="public-ambiguous" aria-labelledby="ambiguous-title">
      <span className="eyebrow">More than one match</span>
      <h2 id="ambiguous-title">Which entity did you mean?</h2>
      <p>CHEERS did not choose silently. Select the intended repository entity to search again.</p>
      {data.ambiguous_matches.map((ambiguity) => (
        <div className="public-alternative-list" key={ambiguity.query_fragment}>
          {ambiguity.candidates.map((candidate) => (
            <button
              type="button"
              key={`${candidate.entity_type}-${candidate.entity_id}`}
              onClick={() => onChoose(ambiguity.query_fragment, candidate.name)}
            >
              <span>
                <strong>{candidate.name}</strong>
                <small>{entityLabel(candidate)} · {candidate.entity_id}</small>
              </span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          ))}
          {ambiguity.total_matches > ambiguity.candidates.length && (
            <p className="public-result-note">
              Showing {ambiguity.candidates.length} of {ambiguity.total_matches} possible matches.
            </p>
          )}
        </div>
      ))}
    </section>
  )
}

function EmptyOrUnknownState({ hasQuery }) {
  return (
    <section className="public-empty-state" aria-labelledby="public-empty-title">
      <Search size={28} aria-hidden="true" />
      <h2 id="public-empty-title">
        {hasQuery ? 'We could not confidently recognize that search' : 'Start with a simple search'}
      </h2>
      <p>
        {hasQuery
          ? 'Try an exact medicine name, DrugBank ID, disease name, or two exact medicine names.'
          : 'Use a few words about a medicine, disease, interaction, or medicine pair.'}
      </p>
    </section>
  )
}

export default function PublicSearch() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() || ''
  const [request, setRequest] = useState({
    query: '',
    data: null,
    error: '',
    foodLifestyleStatus: null,
  })
  const requestIsCurrent = request.query === query
  const data = requestIsCurrent ? request.data : null
  const error = requestIsCurrent ? request.error : ''
  const foodLifestyleStatus = requestIsCurrent ? request.foodLifestyleStatus : null
  const loading = Boolean(query) && !requestIsCurrent

  useEffect(() => {
    if (!query) return undefined

    let active = true
    getJson(`/api/public/search?q=${encodeURIComponent(query)}`).then(
      async (payload) => {
        if (active) {
          if (!payload || typeof payload.intent !== 'string') {
            setRequest({
              query,
              data: null,
              error: 'The public search service returned an invalid response.',
              foodLifestyleStatus: null,
            })
          } else {
            let nextFoodLifestyleStatus = null
            const medicine = payload.recognized_entities?.[0]
            if (
              payload.intent === 'drug_food_lifestyle'
              && medicine?.entity_type === 'drug'
            ) {
              try {
                const medicinePayload = await getJson(
                  `/api/public/medicine?drug_id=${encodeURIComponent(medicine.entity_id)}`,
                )
                const information = medicinePayload?.label_information
                  ?.food_lifestyle_information
                if (information?.status === 'available') {
                  nextFoodLifestyleStatus = information.topics?.some(
                    (item) => item.topic === payload.topic,
                  ) ? 'available' : 'no_explicit_mentions'
                } else {
                  nextFoodLifestyleStatus = [
                    'no_explicit_mentions',
                    'unavailable',
                  ].includes(information?.status)
                    ? information.status
                    : 'unavailable'
                }
              } catch {
                nextFoodLifestyleStatus = 'unavailable'
              }
            }
            if (!active) return
            setRequest({
              query,
              data: payload,
              error: '',
              foodLifestyleStatus: nextFoodLifestyleStatus,
            })
            const destination = publicSearchDestination(payload)
            if (destination) navigate(destination, { replace: true })
          }
        }
      },
      (requestError) => {
        if (active) {
          setRequest({
            query,
            data: null,
            error: requestError.message || 'Search information could not be loaded.',
            foodLifestyleStatus: null,
          })
        }
      },
    )

    return () => {
      active = false
    }
  }, [navigate, query])

  function search(nextQuery) {
    navigate(`/search?q=${encodeURIComponent(nextQuery)}`)
  }

  function chooseAlternative(fragment, name) {
    search(replaceAmbiguousFragment(data.normalized_query || query, fragment, name))
  }

  const recognized = data?.recognized_entities || []
  const isUnknown = data?.intent === 'unknown'
  const isAmbiguous = Boolean(data?.ambiguous_matches?.length)

  return (
    <section className="page public-search-page">
      <div className="public-search-heading">
        <span className="eyebrow">Search & explain</span>
        <h1>Ask CHEERS</h1>
        <p>
          Ask about medicines, diseases, side effects, interactions, or
          treatment-related information.
        </p>
      </div>

      <PublicSearchBox
        key={query}
        initialValue={query}
        label="Ask about medicines or diseases"
        placeholder="Ask a question about medicines or diseases…"
        onSearch={search}
      />

      {query && (
        <p className="public-query-summary">
          Your question <strong>“{query}”</strong>
        </p>
      )}

      {loading && (
        <div className="public-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={22} /> Finding available information…
        </div>
      )}

      {error && (
        <div className="public-error" role="alert">
          <AlertCircle size={22} />
          <div>
            <h2>Search could not be completed</h2>
            <p>{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && !data && <EmptyOrUnknownState hasQuery={false} />}

      {!loading && !error && isUnknown && <EmptyOrUnknownState hasQuery />}

      {!loading && !error && isAmbiguous && (
        <AmbiguousState data={data} onChoose={chooseAlternative} />
      )}

      {!loading && !error && data && !isUnknown && !isAmbiguous && (
        <div className="public-results" aria-live="polite">
          {data.intent === 'drug_for_disease' && (
            <DrugDiseaseAnswer answer={data.answer} />
          )}
          {data.intent === 'drug_pair_question' && (
            <PairQuestionAnswer answer={data.answer} />
          )}
          {data.intent === 'medicines_for_disease' && recognized[0]?.entity_type === 'disease' && (
            <MedicinesForDiseaseState answer={data.answer} disease={recognized[0]} />
          )}
          {data.intent === 'disease_nutrition' && recognized[0]?.entity_type === 'disease' && (
            <DiseaseNutritionSearchState answer={data.answer} disease={recognized[0]} />
          )}
          {data.intent === 'drug_food_lifestyle' && recognized[0]?.entity_type === 'drug' && (
            <FoodLifestyleSearchState
              data={data}
              entity={recognized[0]}
              status={foodLifestyleStatus}
            />
          )}

          <section className="public-recognized" aria-labelledby="recognized-title">
            <span className="eyebrow">{INTENT_LABELS[data.intent] || 'Search result'}</span>
            <h2 id="recognized-title">We understood this as</h2>
            <div className="public-entity-grid">
              {recognized.map((entity) => (
                <EntityCard key={`${entity.entity_type}-${entity.entity_id}`} entity={entity} />
              ))}
            </div>
          </section>

          {data.intent === 'disease_information' && recognized[0] && (
            <DiseaseExplanation entity={recognized[0]} />
          )}
          {data.intent === 'drug_information' && recognized[0] && (
            <DrugInformationState entity={recognized[0]} />
          )}
          {(data.intent === 'drug_side_effects' || data.intent === 'drug_interactions') && recognized[0] && (
            <SingleDrugTopicState intent={data.intent} entity={recognized[0]} />
          )}
          {(data.intent === 'drug_pair' || data.intent === 'drug_pair_question') && recognized.length === 2 && (
            <PairDestinations data={data} includeChecker={data.intent === 'drug_pair_question'} />
          )}

          <UnavailableModules modules={data.unavailable_modules} intent={data.intent} />
        </div>
      )}

      {!loading && !error && (isUnknown || !query) && (
        <div className="public-example-list public-search-examples" aria-label="Example searches">
          <span>Try:</span>
          {NATURAL_QUESTION_EXAMPLES.map((example) => (
            <button type="button" key={example} onClick={() => search(example)}>
              {example}
            </button>
          ))}
        </div>
      )}

      <aside className="public-result-safety">
        <strong>Information boundary</strong>
        <p>
          {data?.safety_note || (
            'CHEERS does not provide medical advice or decide whether a medicine '
            + 'or medicine combination is safe or appropriate. Consult a qualified '
            + 'health professional for personal decisions.'
          )}
        </p>
        <Link to="/methodology">
          Read the methodology <ExternalLink size={15} />
        </Link>
      </aside>
    </section>
  )
}
