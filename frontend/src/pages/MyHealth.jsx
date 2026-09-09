import {
  AlertCircle,
  ArrowRight,
  Beaker,
  GitBranch,
  HeartPulse,
  Info,
  LoaderCircle,
  Pill,
  Search,
  Utensils,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getJson, pairEndpoint } from '../lib/api.js'
import { generateUniqueMedicinePairs } from '../lib/myMedicines.js'
import { derivePairReviewStatus } from '../lib/pairStatus.js'
import './PublicProduct.css'
import './MyHealth.css'

const MEDICINE_STORAGE_KEY = 'cheers.my-medicines.v1'
const CONDITION_STORAGE_KEY = 'cheers.my-conditions.v1'
const PAIR_STATUS_PRIORITY = { important: 0, review: 1, insufficient: 2 }
const FOOD_TOPIC_LABELS = {
  alcohol: 'Alcohol information',
  grapefruit: 'Grapefruit information',
  vitamin_k: 'Vitamin K information',
  food_or_meals: 'Food / meal information',
  milk_or_dairy: 'Milk / dairy information',
  high_fat_meal: 'High-fat meal information',
  fasting_or_empty_stomach: 'Fasting / empty stomach information',
  smoking_or_tobacco: 'Smoking / tobacco information',
}

function readSavedSelections(storageKey, limit) {
  if (typeof window === 'undefined') return []
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    if (!Array.isArray(stored)) return []
    const seen = new Set()
    return stored.reduce((items, item) => {
      if (
        typeof item?.entity_id !== 'string'
        || typeof item?.name !== 'string'
        || !item.entity_id.trim()
        || !item.name.trim()
        || seen.has(item.entity_id.trim())
        || items.length >= limit
      ) return items
      const selection = {
        entity_id: item.entity_id.trim(),
        name: item.name.trim(),
      }
      seen.add(selection.entity_id)
      items.push(selection)
      return items
    }, [])
  } catch {
    return []
  }
}

function useSavedInformation(items, kind) {
  const [requests, setRequests] = useState({})

  useEffect(() => {
    let active = true
    setRequests(Object.fromEntries(items.map((item) => [
      item.entity_id,
      { status: 'loading', payload: null, error: '' },
    ])))

    async function load() {
      for (const item of items) {
        try {
          const path = kind === 'medicine'
            ? `/api/public/medicine?drug_id=${encodeURIComponent(item.entity_id)}`
            : `/api/public/disease?disease_id=${encodeURIComponent(item.entity_id)}`
          const payload = await getJson(path)
          if (!active) return
          setRequests((current) => ({
            ...current,
            [item.entity_id]: { status: 'ready', payload, error: '' },
          }))
        } catch (requestError) {
          if (!active) return
          setRequests((current) => ({
            ...current,
            [item.entity_id]: {
              status: 'error',
              payload: null,
              error: requestError.message || `${kind} information could not be loaded.`,
            },
          }))
        }
      }
    }

    load()
    return () => {
      active = false
    }
  }, [items, kind])

  return requests
}

function SelectionSummary({ title, items, emptyCopy, addPath, managePath, type }) {
  const isMedicine = type === 'medicine'
  return (
    <section className="my-health-selection-panel" aria-labelledby={`my-health-${type}-title`}>
      <div className="my-health-section-heading">
        <div>
          <span className="eyebrow">Saved on this browser</span>
          <h2 id={`my-health-${type}-title`}>{title}</h2>
        </div>
        {items.length > 0 && <Link to={managePath}>Manage {isMedicine ? 'medicines' : 'conditions'}</Link>}
      </div>
      {items.length ? (
        <div className="my-health-selection-list">
          {items.map((item) => (
            <Link
              key={item.entity_id}
              to={`/${isMedicine ? 'medicines' : 'diseases'}/${encodeURIComponent(item.entity_id)}`}
            >
              {isMedicine ? <Pill size={17} aria-hidden="true" /> : <HeartPulse size={17} aria-hidden="true" />}
              <span><strong>{item.name}</strong><small>{item.entity_id}</small></span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="my-health-soft-empty">
          <p>{emptyCopy}</p>
          <Link to={addPath}>Add {isMedicine ? 'medicines' : 'conditions'} <ArrowRight size={15} /></Link>
        </div>
      )}
    </section>
  )
}

function ModuleNotice({ loading, errors }) {
  if (loading) {
    return <p className="my-health-module-note" role="status"><LoaderCircle className="spin" size={16} /> Loading available information…</p>
  }
  if (errors > 0) {
    return <p className="my-health-module-note is-unavailable"><AlertCircle size={16} /> Some saved-item information could not be loaded. Other available items are shown.</p>
  }
  return null
}

export default function MyHealth() {
  const [medicines] = useState(() => readSavedSelections(MEDICINE_STORAGE_KEY, 8))
  const [conditions] = useState(() => readSavedSelections(CONDITION_STORAGE_KEY, 10))
  const medicineInformation = useSavedInformation(medicines, 'medicine')
  const conditionInformation = useSavedInformation(conditions, 'condition')
  const [pairReview, setPairReview] = useState({ checking: false, current: 0, total: 0, results: [] })
  const reviewIdRef = useRef(0)
  const empty = medicines.length === 0 && conditions.length === 0

  useEffect(() => () => {
    reviewIdRef.current += 1
  }, [])

  const medicineById = new Map(medicines.map((medicine) => [medicine.entity_id, medicine]))
  const connections = { indications: [], other: [] }
  for (const condition of conditions) {
    const payload = conditionInformation[condition.entity_id]?.payload
    for (const [group, destination] of [['indications', connections.indications], ['other', connections.other]]) {
      const relationships = payload?.medicine_relationships?.[group]
      if (!Array.isArray(relationships)) continue
      for (const relationship of relationships) {
        const medicine = medicineById.get(relationship.drug_id)
        if (!medicine) continue
        destination.push({ medicine, condition, relation: relationship.relation })
      }
    }
  }

  const foodLifestyleItems = medicines.flatMap((medicine) => {
    const information = medicineInformation[medicine.entity_id]?.payload
      ?.label_information?.food_lifestyle_information
    if (information?.status !== 'available' || !Array.isArray(information.topics)) return []
    const topics = [...new Set(information.topics
      .map((item) => FOOD_TOPIC_LABELS[item.topic])
      .filter(Boolean))]
    return topics.length ? [{ medicine, topics: topics.slice(0, 3) }] : []
  })
  const nutritionItems = conditions.flatMap((condition) => {
    const nutrition = conditionInformation[condition.entity_id]?.payload?.nutrition_lifestyle
    if (nutrition?.status !== 'available') return []
    return [{ condition, organization: nutrition.source?.organization || '' }]
  })
  const medicineLoading = medicines.some((item) => medicineInformation[item.entity_id]?.status === 'loading')
  const conditionLoading = conditions.some((item) => conditionInformation[item.entity_id]?.status === 'loading')
  const medicineErrors = medicines.filter((item) => medicineInformation[item.entity_id]?.status === 'error').length
  const conditionErrors = conditions.filter((item) => conditionInformation[item.entity_id]?.status === 'error').length
  const pairCount = (medicines.length * (medicines.length - 1)) / 2
  const pairSummary = pairReview.results.reduce((summary, result) => ({
    ...summary,
    [result.status.key]: summary[result.status.key] + 1,
  }), { important: 0, review: 0, insufficient: 0 })
  const orderedPairResults = pairReview.results
    .map((result, index) => ({ ...result, originalIndex: index }))
    .sort((left, right) => (
      PAIR_STATUS_PRIORITY[left.status.key] - PAIR_STATUS_PRIORITY[right.status.key]
      || left.originalIndex - right.originalIndex
    ))

  async function reviewMedicineCombinations() {
    const pairs = generateUniqueMedicinePairs(medicines)
    if (!pairs.length || pairReview.checking) return
    const reviewId = reviewIdRef.current + 1
    reviewIdRef.current = reviewId
    setPairReview({ checking: true, current: 1, total: pairs.length, results: [] })

    for (let index = 0; index < pairs.length; index += 1) {
      if (reviewIdRef.current !== reviewId) return
      const pair = pairs[index]
      setPairReview((current) => ({ ...current, current: index + 1 }))
      let evidence = null
      let failed = false
      try {
        evidence = await getJson(pairEndpoint(
          '/api/evidence/pair',
          pair.drugA.entity_id,
          pair.drugB.entity_id,
        ))
      } catch {
        failed = true
      }
      if (reviewIdRef.current !== reviewId) return
      setPairReview((current) => ({
        ...current,
        results: [...current.results, {
          pair,
          failed,
          status: derivePairReviewStatus(evidence, failed),
        }],
      }))
    }

    if (reviewIdRef.current === reviewId) {
      setPairReview((current) => ({ ...current, checking: false }))
    }
  }

  return (
    <section className="page product-page my-health-page">
      <header className="product-page-header">
        <span className="eyebrow">My Health</span>
        <h1>Your selected medicines and conditions, brought together in one place.</h1>
        <p>Use this overview to reach available CHEERS information without creating a clinical profile.</p>
      </header>

      <aside className="my-health-privacy">
        <Info size={18} aria-hidden="true" />
        <p><strong>Your selections stay on this browser.</strong> CHEERS uses them only to organize available information. CHEERS does not diagnose conditions, prescribe medicines, or determine personal treatment suitability.</p>
      </aside>

      {empty ? (
        <section className="my-health-onboarding" aria-labelledby="my-health-onboarding-title">
          <span className="my-health-onboarding-icon"><HeartPulse size={27} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">Local, optional personalization</span>
            <h2 id="my-health-onboarding-title">Build your CHEERS health view</h2>
            <p>Add medicines and conditions to organize interaction information, food/lifestyle label information, disease nutrition information, and typed medicine–condition relationships.</p>
          </div>
          <div className="my-health-onboarding-actions">
            <Link className="primary-button" to="/my-medicines">Add medicines</Link>
            <Link className="secondary-button" to="/my-conditions">Add conditions</Link>
          </div>
        </section>
      ) : (
        <>
          <section className="my-health-counts" aria-label="Saved information summary">
            <article><Pill size={18} /><strong>{medicines.length}</strong><span>medicines</span></article>
            <article><HeartPulse size={18} /><strong>{conditions.length}</strong><span>conditions</span></article>
            <article><Beaker size={18} /><strong>{pairCount}</strong><span>medicine combinations</span></article>
            <article><GitBranch size={18} /><strong>{connections.indications.length + connections.other.length}</strong><span>medicine–condition relationships</span></article>
            <article><Utensils size={18} /><strong>{nutritionItems.length}</strong><span>nutrition modules available</span></article>
          </section>

          <div className="my-health-selection-grid">
            <SelectionSummary
              title="My medicines"
              items={medicines}
              emptyCopy="Add medicines to see interaction and food/lifestyle information."
              addPath="/my-medicines"
              managePath="/my-medicines"
              type="medicine"
            />
            <SelectionSummary
              title="My conditions"
              items={conditions}
              emptyCopy="Add conditions to see related medicine and nutrition information."
              addPath="/my-conditions"
              managePath="/my-conditions"
              type="condition"
            />
          </div>

          <section className="my-health-module" aria-labelledby="my-health-pairs-title">
            <div className="my-health-section-heading">
              <div><span className="eyebrow">On demand</span><h2 id="my-health-pairs-title">Medicine combination review</h2></div>
              <Link to="/my-medicines">Open My Medicines</Link>
            </div>
            {medicines.length < 2 ? (
              <div className="my-health-soft-empty"><p>Add at least two medicines to review combinations.</p><Link to="/my-medicines">Manage medicines <ArrowRight size={15} /></Link></div>
            ) : (
              <>
                {!pairReview.results.length && !pairReview.checking && (
                  <div className="my-health-review-prompt">
                    <p>Review {pairCount} combinations using the same source-based statuses as My Medicines.</p>
                    <button className="primary-button" type="button" onClick={reviewMedicineCombinations}><Beaker size={17} /> Review medicine combinations</button>
                  </div>
                )}
                {pairReview.checking && (
                  <p className="my-health-module-note" role="status"><LoaderCircle className="spin" size={17} /> Reviewing {pairReview.current} of {pairReview.total} combinations…</p>
                )}
                {pairReview.results.length > 0 && (
                  <>
                    <div className="my-health-pair-summary" aria-label="Medicine combination summary">
                      <article className="is-important"><strong>{pairSummary.important}</strong><span>interaction warnings</span></article>
                      <article className="is-review"><strong>{pairSummary.review}</strong><span>needs review</span></article>
                      <article className="is-insufficient"><strong>{pairSummary.insufficient}</strong><span>not enough information</span></article>
                    </div>
                    <div className="my-health-pair-list" aria-label="Medicine combinations by information priority">
                      {orderedPairResults.slice(0, 3).map((result) => (
                        <article className={`my-health-pair-item is-${result.status.key}`} key={`${result.pair.drugA.entity_id}-${result.pair.drugB.entity_id}`}>
                          <span>{result.status.title}</span>
                          <strong>{result.pair.drugA.name} + {result.pair.drugB.name}</strong>
                          {result.failed && <small>Source request unavailable</small>}
                        </article>
                      ))}
                    </div>
                    <p className="my-health-priority-note">Pairs are ordered only to surface available information: warning, review, then insufficient information. This is not clinical severity ranking.</p>
                  </>
                )}
              </>
            )}
          </section>

          <section className="my-health-module" aria-labelledby="my-health-connections-title">
            <div className="my-health-section-heading">
              <div><span className="eyebrow">Checked typed relationships</span><h2 id="my-health-connections-title">Medicine + condition connections</h2></div>
            </div>
            <ModuleNotice loading={conditionLoading} errors={conditionErrors} />
            {!conditionLoading && medicines.length > 0 && conditions.length > 0 && connections.indications.length === 0 && connections.other.length === 0 && (
              <p className="my-health-neutral-copy">No typed relationships among the saved medicines and conditions were found in the checked Disease Guide data.</p>
            )}
            {connections.indications.length > 0 && (
              <div className="my-health-connection-group">
                <h3>Treatment indication</h3>
                {connections.indications.map((connection) => (
                  <article key={`${connection.medicine.entity_id}-${connection.condition.entity_id}-${connection.relation}`}>
                    <strong>{connection.medicine.name}</strong><ArrowRight size={15} /><span>{connection.condition.name}</span><b>Indication</b>
                  </article>
                ))}
              </div>
            )}
            {connections.other.length > 0 && (
              <div className="my-health-connection-group is-other">
                <h3>Other biomedical relationships</h3>
                {connections.other.map((connection) => (
                  <article key={`${connection.medicine.entity_id}-${connection.condition.entity_id}-${connection.relation}`}>
                    <strong>{connection.medicine.name}</strong><ArrowRight size={15} /><span>{connection.condition.name}</span><b>{connection.relation}</b>
                  </article>
                ))}
              </div>
            )}
            {(medicines.length === 0 || conditions.length === 0) && (
              <p className="my-health-neutral-copy">Save at least one medicine and one condition to see existing typed relationships.</p>
            )}
          </section>

          <div className="my-health-module-grid">
            <section className="my-health-module" aria-labelledby="my-health-food-title">
              <div className="my-health-section-heading"><div><span className="eyebrow">Official label topics</span><h2 id="my-health-food-title">Food &amp; lifestyle information</h2></div></div>
              <ModuleNotice loading={medicineLoading} errors={medicineErrors} />
              <div className="my-health-availability-list">
                {foodLifestyleItems.map(({ medicine, topics }) => (
                  <article key={medicine.entity_id}>
                    <div><strong>{medicine.name}</strong>{topics.map((topic) => <span key={topic}>{topic} available</span>)}</div>
                    <Link to={`/medicines/${encodeURIComponent(medicine.entity_id)}?section=food-lifestyle`}>View Food &amp; lifestyle</Link>
                  </article>
                ))}
              </div>
              {!medicineLoading && medicines.length > 0 && foodLifestyleItems.length === 0 && (
                <p className="my-health-neutral-copy">No explicit food or lifestyle topic is currently available from the checked label modules. This does not establish safety.</p>
              )}
              {medicines.length === 0 && <p className="my-health-neutral-copy">Add medicines to surface available label topics.</p>}
            </section>

            <section className="my-health-module" aria-labelledby="my-health-nutrition-title">
              <div className="my-health-section-heading"><div><span className="eyebrow">Reviewed disease education</span><h2 id="my-health-nutrition-title">Nutrition &amp; lifestyle information</h2></div></div>
              <ModuleNotice loading={conditionLoading} errors={conditionErrors} />
              <div className="my-health-availability-list">
                {nutritionItems.map(({ condition, organization }) => (
                  <article key={condition.entity_id}>
                    <div><strong>{condition.name}</strong><span>Nutrition &amp; lifestyle information available</span>{organization && <small>Source: {organization}</small>}</div>
                    <Link to={`/diseases/${encodeURIComponent(condition.entity_id)}?section=nutrition-lifestyle`}>View Nutrition &amp; lifestyle</Link>
                  </article>
                ))}
              </div>
              {!conditionLoading && conditions.length > 0 && nutritionItems.length === 0 && (
                <p className="my-health-neutral-copy">No reviewed nutrition module is currently available for the saved conditions.</p>
              )}
              {conditions.length === 0 && <p className="my-health-neutral-copy">Add conditions to surface reviewed nutrition information.</p>}
            </section>
          </div>

          <section className="my-health-explore" aria-labelledby="my-health-explore-title">
            <div><span className="eyebrow">Optional deeper information</span><h2 id="my-health-explore-title">Explore deeper</h2></div>
            <nav aria-label="My Health next steps">
              <Link to="/check"><Beaker size={17} /> Check two medicines</Link>
              <Link to="/medicines"><Pill size={17} /> Medicine Guide</Link>
              <Link to="/diseases"><HeartPulse size={17} /> Disease Guide</Link>
              <Link to="/graph"><Search size={17} /> Explore graph context</Link>
            </nav>
          </section>
        </>
      )}
    </section>
  )
}
