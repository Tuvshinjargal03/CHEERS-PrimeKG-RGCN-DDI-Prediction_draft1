import {
  AlertCircle,
  ArrowRight,
  Beaker,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Info,
  LoaderCircle,
  Network,
  Pill,
  Search,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PublicSearchBox from '../components/PublicSearchBox.jsx'
import { getJson, postJson } from '../lib/api.js'
import { publicSearchDestination } from '../lib/publicSearchRouting.js'
import './PublicSearch.css'

const MODULE_LABELS = {
  disease_explanation: 'Disease explanation',
  drug_explanation: 'General medicine explanation',
  drug_side_effects: 'Medicine side-effect information',
  single_drug_label_interactions: 'Single-medicine label interactions',
  drug_food_lifestyle_information: 'Food & lifestyle label information',
  pair_external_evidence: 'Medicine-pair source information',
  pair_graph_context: 'Shared biomedical research connections',
  research_graph_context: 'Biomedical research connections',
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
  'What does metformin do?',
  'Metformin side effects',
  'Warfarin and aspirin together?',
  'What is diabetes?',
]

const PUBLIC_SEARCH_TIMEOUT_MS = 65_000
const PUBLIC_EXPLANATION_TIMEOUT_MS = 15_000
const SLOW_SEARCH_NOTICE_MS = 10_000

const DESTINATION_DETAILS = {
  pair_external_evidence: {
    title: 'Review sources',
    description: 'Open independent openFDA and PubMed information retrieved for this pair.',
    icon: Beaker,
  },
  pair_graph_context: {
    title: 'Explore relationships',
    description: 'View available gene/protein and disease relationships in the knowledge graph.',
    icon: Network,
  },
}

function entityLabel(entity) {
  return entity.entity_type === 'disease' ? 'Disease' : 'Medicine'
}

function displayEntityName(entity) {
  return entity?.display_name || entity?.name || ''
}

function answerTitle(data, entities, query = '') {
  const first = entities[0]
  const firstName = displayEntityName(first)
  if (data.intent === 'drug_side_effects') return `${firstName} side effects`
  if (data.intent === 'drug_information') return `About ${firstName}`
  if (data.intent === 'drug_pair_question' || data.intent === 'drug_pair') {
    return entities.map(displayEntityName).join(' + ')
  }
  if (data.intent === 'general_symptom_or_treatment_question' && first) {
    const wording = data.normalized_query || data.original_query || query
    return `${firstName} and ${wording.toLocaleLowerCase().includes('pain') ? 'pain' : 'your question'}`
  }
  if (data.intent === 'disease_information' && first) return sentenceCase(firstName)
  return firstName || 'Your CHEERS answer'
}

const CORRECTION_WORDS = new Set([
  'about', 'and', 'can', 'does', 'effects', 'efects', 'for', 'information', 'side',
  'take', 'tell', 'the', 'together', 'use', 'used', 'what', 'with', 'your', 'pain',
])

function correctionFragment(query, entity) {
  if (entity?.match_type === 'exact_common_name') return displayEntityName(entity).toLocaleLowerCase()
  if (entity?.match_type !== 'close_fuzzy_name') return ''
  return String(query || '').toLocaleLowerCase().match(/[a-z0-9-]+/g)
    ?.filter((word) => word.length > 2 && !CORRECTION_WORDS.has(word))
    .sort((left, right) => right.length - left.length)[0] || ''
}

function MatchIndicator({ query, entities }) {
  const matches = entities
    .map((entity) => ({ entity, fragment: correctionFragment(query, entity) }))
    .filter(({ fragment }) => fragment)
  if (!matches.length) return null
  const alias = matches.find(({ entity }) => entity.display_name && entity.display_name !== entity.name)
  return (
    <div className="public-match-note">
      <Sparkles size={15} aria-hidden="true" />
      <span>
        {matches.map(({ entity, fragment }) => `Matched “${fragment}” to ${displayEntityName(entity)}`).join(' · ')}
        {alias ? ` · Database name: ${alias.entity.name}` : ''}
      </span>
    </div>
  )
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
  const medicinePath = `/medicines/${encodeURIComponent(entity.entity_id)}`
  return (
    <section className="public-neutral-state" aria-labelledby="drug-information-status">
      <BookOpen size={21} aria-hidden="true" />
      <div>
        <h2 id="drug-information-status">Medicine information available</h2>
        <p>
          CHEERS recognized {displayEntityName(entity)}. Open its medicine
          profile to review available official label information and related connections.
        </p>
        <div className="public-answer-actions">
          <Link to={medicinePath}>View medicine</Link>
          <Link to={`${medicinePath}?section=side-effects`}>Side effects</Link>
          <Link to={`/check?drug_a_id=${encodeURIComponent(entity.entity_id)}`}>Check Medicines</Link>
          <Link to={`${medicinePath}?section=uses`}>Original source</Link>
        </div>
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
        {available ? 'View Nutrition & lifestyle' : 'View disease'}
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
        <Link to={`/medicines/${encodeURIComponent(drug.entity_id)}`}>View medicine</Link>
        <Link to={`/diseases/${encodeURIComponent(disease.entity_id)}`}>View disease</Link>
        <Link to={`/check?drug_a_id=${encodeURIComponent(drug.entity_id)}`}>Check Medicines</Link>
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

function PairQuestionAnswer({ answer, explanation, entities = [] }) {
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
  const displayName = (drug) => (
    entities.find((entity) => entity.entity_id === drug.entity_id)?.display_name || drug.name
  )

  return (
    <section className={`public-direct-answer is-${state.tone}`} aria-labelledby="pair-question-answer-title">
      <div className="public-direct-answer-heading public-pair-heading">
        <span className="public-direct-answer-icon"><Icon size={22} aria-hidden="true" /></span>
        <div>
          <span className="public-answer-status-label">{answer.direct_answer}</span>
          <h2 id="pair-question-answer-title">{displayName(answer.drug_1)} + {displayName(answer.drug_2)}</h2>
        </div>
      </div>
      <div className="public-pair-medicines" aria-label="Medicines in this pair">
        {[answer.drug_1, answer.drug_2].map((drug) => {
          const matched = entities.find((entity) => entity.entity_id === drug.entity_id)
          return (
            <div key={drug.entity_id}>
              <Pill size={18} aria-hidden="true" />
              <span>
                <strong>{displayName(drug)}</strong>
                {matched?.display_name && <small>{drug.name}</small>}
              </span>
            </div>
          )
        })}
      </div>
      {(explanation?.short_answer || answer.supporting_text) && (
        <p className="public-direct-answer-copy">{explanation?.short_answer || answer.supporting_text}</p>
      )}
      <div className="public-answer-facts public-evidence-counts" aria-label="Retrieved source counts">
        {Number.isFinite(counts.label_mentions) && (
          <div><span>Official label matches</span><strong>{counts.label_mentions}</strong><small>FDA label</small></div>
        )}
        {Number.isFinite(counts.pubmed_records) && (
          <div><span>Research articles</span><strong>{counts.pubmed_records}</strong><small>PubMed</small></div>
        )}
      </div>
      {(explanation?.what_we_cannot_conclude || answer.safety_note) && (
        <div className="public-answer-boundary">
          <strong>Keep in mind</strong>
          <p>{explanation?.what_we_cannot_conclude || answer.safety_note}</p>
        </div>
      )}
      <SourceChips
        sources={explanation?.sources_used}
        checked={Object.values(counts).some((count) => count === 0)}
      />
    </section>
  )
}

function SourceChips({ sources, checked }) {
  if (!sources?.length) return null
  return (
    <div className="public-source-row" aria-label={checked ? 'Sources checked' : 'Sources used'}>
      <span>{checked ? 'Sources checked' : 'Sources'}</span>
      {sources.map((source) => <span className="public-source-chip" key={source}>{source}</span>)}
    </div>
  )
}

function PlainLanguageExplanation({ explanation, evidenceSummary, title, matchNote, actions }) {
  if (!explanation?.short_answer) return null
  const checked = evidenceSummary && Object.values(evidenceSummary).some((count) => count === 0)
  return (
    <section className="public-answer-card" aria-labelledby="plain-answer-title">
      {matchNote}
      <h2 id="plain-answer-title">{title}</h2>
      <p className="public-answer-text">{explanation.short_answer}</p>
      {explanation.key_points?.length > 0 && (
        <div className="public-key-points">
          <h3>Key things to know</h3>
          <ul>{explanation.key_points.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
      )}
      {explanation.what_we_cannot_conclude && (
        <div className="public-answer-boundary">
          <strong>Keep in mind</strong>
          <p>{explanation.what_we_cannot_conclude}</p>
        </div>
      )}
      <SourceChips sources={explanation.sources_used} checked={checked} />
      {actions}
    </section>
  )
}

function ResultActions({ intent, entity }) {
  if (!entity || !['drug_information', 'drug_side_effects'].includes(intent)) return null
  const medicinePath = `/medicines/${encodeURIComponent(entity.entity_id)}`
  return (
    <div className="public-answer-actions public-answer-primary-actions" aria-label="Explore more">
      <Link to={medicinePath}>View medicine</Link>
      <Link to={`${medicinePath}?section=uses`}>Uses</Link>
      <Link to={`${medicinePath}?section=side-effects`}>Side effects</Link>
      <Link to={`/check?drug_a_id=${encodeURIComponent(entity.entity_id)}`}>Check Medicines</Link>
      <Link to={`${medicinePath}?section=${intent === 'drug_side_effects' ? 'side-effects' : 'uses'}`}>Original source</Link>
    </div>
  )
}

function WhyThisAnswer({ data, entities }) {
  if (!entities.length) return null
  const counts = data.answer?.evidence_summary
  return (
    <details className="public-answer-details">
      <summary>Why this answer?</summary>
      <div>
        {entities.map((entity) => (
          <p key={`${entity.entity_type}-${entity.entity_id}`}>
            <strong>{displayEntityName(entity)}</strong> · {entityLabel(entity)}
          </p>
        ))}
        {counts && <p>Official label matches: {counts.label_mentions} (FDA label) · PubMed research articles: {counts.pubmed_records}</p>}
        {data.available_modules?.includes('pair_graph_context') && <p>Knowledge-graph relationships are available separately.</p>}
        <p>Research-model rankings are separate from FDA, PubMed, and knowledge-graph information.</p>
      </div>
    </details>
  )
}

function TreatmentQuestionNextSteps({ medicine }) {
  const medicinePath = medicine
    ? `/medicines/${encodeURIComponent(medicine.entity_id)}`
    : '/medicines'
  const checkerPath = medicine
    ? `/check?drug_a_id=${encodeURIComponent(medicine.entity_id)}`
    : '/check'
  return (
    <section className="public-next-steps" aria-labelledby="treatment-next-steps">
      <div className="public-section-heading">
        <span className="eyebrow">Next steps</span>
        <h2 id="treatment-next-steps">Review information without choosing a treatment</h2>
      </div>
      <div className="public-answer-actions">
        <Link to={medicinePath}>{medicine ? 'View medicine' : 'Find a medicine profile'}</Link>
        {medicine && <Link to={`${medicinePath}?section=uses`}>Uses</Link>}
        {medicine && <Link to={`${medicinePath}?section=side-effects`}>Side effects</Link>}
        <Link to={checkerPath}>Check Medicines</Link>
      </div>
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
        <h2 id="pair-next-steps-title">Explore more</h2>
      </div>
      <div className="public-destination-grid">
        {includeChecker && checkerParams && (
          <Link to={`/check?${checkerParams}`} className="public-destination-card">
            <span><Pill size={20} /></span>
            <div>
              <h3>Check Medicines</h3>
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
        Source information and research connections are independent of the R-GCN ranking score.
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
  const isGeneralDiabetes = data.intent === 'disease_information'
    && /^(?:what is|what s|tell me about)?\s*diabetes$/.test(data.normalized_query || '')
  const topic = isGeneralDiabetes ? 'diabetes condition' : 'match'
  return (
    <section className="public-ambiguous" aria-labelledby="ambiguous-title">
      <h2 id="ambiguous-title">{isGeneralDiabetes ? 'Diabetes' : `Which ${topic} do you mean?`}</h2>
      <p>
        {isGeneralDiabetes
          ? 'CHEERS does not have a single general diabetes description in its reviewed data.'
          : 'Choose the closest match to continue.'}
      </p>
      {isGeneralDiabetes && <h3>Explore specific diabetes conditions</h3>}
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
                <small>{entityLabel(candidate)}</small>
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
      <h2 id="public-empty-title">{hasQuery ? 'I couldn’t answer that directly.' : 'Start with a simple search'}</h2>
      <p>
        {hasQuery
          ? 'Try a medicine name, a disease, or two medicines you want to compare.'
          : 'Use a few words about a medicine, disease, interaction, or medicine pair.'}
      </p>
      {hasQuery && (
        <div className="public-answer-actions">
          <Link to="/medicines">Browse medicines</Link>
          <Link to="/diseases">Browse diseases</Link>
          <Link to="/check">Check Medicines</Link>
        </div>
      )}
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
  const [attempt, setAttempt] = useState(0)
  const [slowSearchQuery, setSlowSearchQuery] = useState('')
  const requestIsCurrent = request.query === query
  const data = requestIsCurrent ? request.data : null
  const error = requestIsCurrent ? request.error : ''
  const foodLifestyleStatus = requestIsCurrent ? request.foodLifestyleStatus : null
  const loading = Boolean(query) && !requestIsCurrent
  const slowSearch = loading && slowSearchQuery === query

  useEffect(() => {
    if (!query) return undefined

    let active = true
    const slowNoticeId = setTimeout(() => {
      if (active) setSlowSearchQuery(query)
    }, SLOW_SEARCH_NOTICE_MS)
    getJson(`/api/public/search?q=${encodeURIComponent(query)}`, {
      timeoutMs: PUBLIC_SEARCH_TIMEOUT_MS,
    }).then(
      (payload) => {
        if (active) {
          clearTimeout(slowNoticeId)
          setSlowSearchQuery('')
          if (!payload || typeof payload.intent !== 'string') {
            setRequest({
              query,
              data: null,
              error: 'CHEERS could not load this answer. Please try again.',
              foodLifestyleStatus: null,
            })
          } else {
            setRequest({
              query,
              data: payload,
              error: '',
              foodLifestyleStatus: null,
            })
            const destination = publicSearchDestination(payload)
            if (destination) {
              navigate(destination, { replace: true })
              return
            }

            const medicine = payload.recognized_entities?.[0]
            if (
              payload.intent === 'drug_food_lifestyle'
              && medicine?.entity_type === 'drug'
            ) {
              getJson(
                  `/api/public/medicine?drug_id=${encodeURIComponent(medicine.entity_id)}`,
              ).then((medicinePayload) => {
                const information = medicinePayload?.label_information
                  ?.food_lifestyle_information
                let nextFoodLifestyleStatus = 'unavailable'
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
                if (!active) return
                setRequest((current) => current.query === query
                  ? { ...current, foodLifestyleStatus: nextFoodLifestyleStatus }
                  : current)
              }, () => {
                if (!active) return
                setRequest((current) => current.query === query
                  ? { ...current, foodLifestyleStatus: 'unavailable' }
                  : current)
              })
            }

            if (payload.ai_explanation_eligible) {
              postJson(
                '/api/public/explain',
                { query },
                { timeoutMs: PUBLIC_EXPLANATION_TIMEOUT_MS },
              ).then((enhanced) => {
                if (!active || !enhanced || typeof enhanced.intent !== 'string') return
                setRequest((current) => current.query === query
                  ? { ...current, data: enhanced }
                  : current)
              }, () => {
                // The deterministic result remains visible when AI or sources fail.
              })
            }
          }
        }
      },
      (requestError) => {
        if (active) {
          clearTimeout(slowNoticeId)
          setSlowSearchQuery('')
          setRequest({
            query,
            data: null,
            error: requestError.code === 'REQUEST_TIMEOUT'
              ? 'CHEERS is taking longer than expected. Please try again.'
              : 'CHEERS could not load this answer. Please try again.',
            foodLifestyleStatus: null,
          })
        }
      },
    )

    return () => {
      active = false
      clearTimeout(slowNoticeId)
    }
  }, [attempt, navigate, query])

  function search(nextQuery) {
    navigate(`/search?q=${encodeURIComponent(nextQuery)}`)
  }

  function chooseAlternative(fragment, name) {
    search(replaceAmbiguousFragment(data.normalized_query || query, fragment, name))
  }

  function retrySearch() {
    setRequest((current) => ({ ...current, query: '' }))
    setAttempt((current) => current + 1)
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
        disabled={loading}
      />

      {query && (
        <p className="public-query-summary">
          Your question <strong>“{query}”</strong>
        </p>
      )}

      {loading && (
        <div className="public-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={22} />
          <div>
            <strong>{slowSearch ? 'Still working — the information service may be starting up.' : 'Searching CHEERS…'}</strong>
            {slowSearch && <p>The first search can sometimes take a little longer.</p>}
          </div>
        </div>
      )}

      {error && (
        <div className="public-error" role="alert">
          <AlertCircle size={22} />
          <div>
            <h2>I couldn’t load that answer.</h2>
            <p>{error}</p>
            <button type="button" className="secondary-button public-retry-button" onClick={retrySearch}>Try again</button>
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
          <PlainLanguageExplanation
            explanation={data.intent === 'drug_pair_question' ? null : data.explanation}
            evidenceSummary={data.intent === 'drug_pair_question' ? data.answer?.evidence_summary : undefined}
            title={answerTitle(data, recognized, query)}
            matchNote={<MatchIndicator query={query} entities={recognized} />}
            actions={<ResultActions intent={data.intent} entity={recognized[0]} />}
          />
          {data.intent === 'general_symptom_or_treatment_question' && (
            <TreatmentQuestionNextSteps medicine={recognized[0]} />
          )}
          {data.intent === 'drug_for_disease' && (
            <DrugDiseaseAnswer answer={data.answer} />
          )}
          {data.intent === 'drug_pair_question' && (
            <PairQuestionAnswer answer={data.answer} explanation={data.explanation} entities={recognized} />
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

          {data.intent === 'disease_information' && recognized[0] && (
            <DiseaseExplanation entity={recognized[0]} />
          )}
          {data.intent === 'drug_information' && recognized[0] && !data.explanation && (
            <DrugInformationState entity={recognized[0]} />
          )}
          {(data.intent === 'drug_side_effects' || data.intent === 'drug_interactions') && recognized[0] && !data.explanation && (
            <SingleDrugTopicState intent={data.intent} entity={recognized[0]} />
          )}
          {(data.intent === 'drug_pair' || data.intent === 'drug_pair_question') && recognized.length === 2 && (
            <PairDestinations data={data} includeChecker={data.intent === 'drug_pair_question'} />
          )}

          <WhyThisAnswer data={data} entities={recognized} />

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
        <strong>Important</strong>
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
