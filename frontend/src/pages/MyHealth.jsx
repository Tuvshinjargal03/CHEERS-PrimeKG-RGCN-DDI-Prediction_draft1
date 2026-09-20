import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CircleAlert,
  FileQuestion,
  Files,
  HeartPulse,
  Info,
  LoaderCircle,
  Pill,
  SearchCheck,
} from 'lucide-react';
import DrugAutocomplete from '../components/DrugAutocomplete';
import { getJson, pairEndpoint } from '../lib/api';
import { mapWithConcurrency } from '../lib/mapWithConcurrency';
import {
  MAX_SAVED_MEDICINES,
  SAVED_MEDICINES_STORAGE_KEY,
} from '../lib/myMedicines';
import { derivePairReviewStatus } from '../lib/pairStatus.js';
import './MyHealth.css';

const SAVED_CONDITIONS_STORAGE_KEY = 'cheers.my-conditions.v1';
const MAX_CONDITIONS = 8;
const MAX_CONCURRENT_REQUESTS = 4;
const COMPACT_RESULT_COUNT = 3;

const PAIR_STATUS_PRESENTATION = {
  important: {
    label: 'Interaction information found',
    description: 'An explicit cross-medicine name mention was retrieved from the checked FDA label sections.',
    Icon: CircleAlert,
  },
  review: {
    label: 'Literature found',
    description: 'PubMed returned name-matched literature records for this medicine pair.',
    Icon: BookOpen,
  },
  insufficient: {
    label: 'No matching information retrieved',
    description: 'The checked sources returned no structured pair information for these medicine names.',
    Icon: FileQuestion,
  },
};

function readSavedSelections(storageKey, limit) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(parsed)) return [];

    const seen = new Set();
    return parsed
      .filter((item) => {
        if (!item || typeof item.entity_id !== 'string' || typeof item.name !== 'string') return false;
        const entityId = item.entity_id.trim();
        const name = item.name.trim();
        if (!entityId || !name || seen.has(entityId)) return false;
        seen.add(entityId);
        return true;
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}

function useSavedInformation(items, kind) {
  const [information, setInformation] = useState({});
  const [loading, setLoading] = useState(false);
  const runIdRef = useRef(0);
  const itemKey = items.map((item) => item.entity_id).join('|');

  useEffect(() => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    if (!items.length) {
      void Promise.resolve().then(() => {
        if (runIdRef.current !== runId) return;
        setInformation({});
        setLoading(false);
      });
      return undefined;
    }

    void Promise.resolve().then(() => {
      if (runIdRef.current !== runId) return;
      setInformation({});
      setLoading(true);
    });
    let completed = 0;

    void mapWithConcurrency(
      items,
      MAX_CONCURRENT_REQUESTS,
      (item) => {
        const parameter = kind === 'medicine' ? 'drug_id' : 'disease_id';
        return getJson(`/api/public/${kind}?${parameter}=${encodeURIComponent(item.entity_id)}`);
      },
      (settled, itemIndex) => {
        if (runIdRef.current !== runId) return;
        completed += 1;
        const result = settled.status === 'fulfilled'
          ? { status: 'ready', payload: settled.value }
          : { status: 'error', payload: null };
        setInformation((current) => ({
          ...current,
          [items[itemIndex].entity_id]: result,
        }));
        if (completed === items.length) setLoading(false);
      },
      () => runIdRef.current !== runId,
    );

    return () => {
      if (runIdRef.current === runId) runIdRef.current += 1;
    };
  }, [itemKey, items, kind]);

  return { information, loading };
}

function ContextGroup({ title, items, emptyLabel, actionLabel, actionTo }) {
  const visibleItems = items.slice(0, 5);
  const remainingCount = items.length - visibleItems.length;

  return (
    <div className="health-context-group">
      <div className="health-context-group__heading">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <div className="health-context-items" aria-label={`Saved ${title.toLowerCase()}`}>
          {visibleItems.map((item) => (
            <span className="health-context-chip" key={item.entity_id} title={item.name}>
              {item.name}
            </span>
          ))}
          {remainingCount > 0 ? (
            <span className="health-context-more">+{remainingCount} more</span>
          ) : null}
        </div>
      ) : (
        <p className="health-context-empty">{emptyLabel}</p>
      )}
      <Link className="health-context-action" to={actionTo}>
        {actionLabel}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

function CapabilityTile({ Icon, title, description }) {
  return (
    <article className="health-capability-tile">
      <span className="health-capability-icon" aria-hidden="true">
        <Icon size={19} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  );
}

function readableTopicName(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Official label topic';
  const words = value.trim().replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function PairResult({ result }) {
  const presentation = result.failed
    ? {
        label: 'Source information unavailable',
        description: 'This pair could not be retrieved. Other medicine pairs were still checked.',
        Icon: AlertCircle,
      }
    : PAIR_STATUS_PRESENTATION[result.status] || PAIR_STATUS_PRESENTATION.insufficient;
  const StatusIcon = presentation.Icon;

  return (
    <article className={`health-pair-result health-pair-result--${result.failed ? 'unavailable' : result.status}`}>
      <div className="health-pair-result__icon" aria-hidden="true">
        <StatusIcon size={18} />
      </div>
      <div className="health-pair-result__content">
        <div className="health-pair-result__heading">
          <div>
            <h4>{result.savedMedicine.name}</h4>
            <p className="health-pair-result__pair">
              With {result.candidate.name}
            </p>
          </div>
          <span className="health-pair-status">{presentation.label}</span>
        </div>
        <p>{presentation.description}</p>
        {!result.failed ? (
          <Link
            className="health-result-link"
            to={`/evidence?drug_a_id=${encodeURIComponent(result.savedMedicine.entity_id)}&drug_b_id=${encodeURIComponent(result.candidate.entity_id)}`}
          >
            Review evidence
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function MyHealth() {
  const [savedMedicines] = useState(() =>
    readSavedSelections(SAVED_MEDICINES_STORAGE_KEY, MAX_SAVED_MEDICINES),
  );
  const [savedConditions] = useState(() =>
    readSavedSelections(SAVED_CONDITIONS_STORAGE_KEY, MAX_CONDITIONS),
  );
  const [candidate, setCandidate] = useState(null);
  const [candidateReview, setCandidateReview] = useState({
    checking: false,
    completed: false,
    current: 0,
    total: 0,
    results: [],
    medicineInformationStatus: 'idle',
    medicineInformation: null,
  });
  const [showAllPairs, setShowAllPairs] = useState(false);
  const reviewIdRef = useRef(0);

  const { information: savedMedicineInformation } = useSavedInformation(savedMedicines, 'medicine');
  const {
    information: savedConditionInformation,
    loading: savedConditionsLoading,
  } = useSavedInformation(savedConditions, 'disease');

  useEffect(() => () => {
    reviewIdRef.current += 1;
  }, []);

  const eligibleSavedMedicines = useMemo(
    () => savedMedicines.filter((medicine) => medicine.entity_id !== candidate?.entity_id),
    [candidate?.entity_id, savedMedicines],
  );

  const sortedPairResults = useMemo(() => {
    const priority = { important: 0, review: 1, insufficient: 2 };
    return [...candidateReview.results].sort((left, right) => {
      const leftPriority = left.failed ? 3 : (priority[left.status] ?? 2);
      const rightPriority = right.failed ? 3 : (priority[right.status] ?? 2);
      return leftPriority - rightPriority || left.originalIndex - right.originalIndex;
    });
  }, [candidateReview.results]);

  const conditionConnections = useMemo(() => {
    if (!candidate) return [];

    const connections = [];
    savedConditions.forEach((condition) => {
      const payload = savedConditionInformation[condition.entity_id]?.payload;
      if (!payload) return;
      const relationships = [
        ...(payload.medicine_relationships?.indications || []),
        ...(payload.medicine_relationships?.other || []),
      ];
      relationships.forEach((relationship) => {
        if (relationship.drug_id === candidate.entity_id) {
          connections.push({
            condition,
            relation: relationship.relation,
          });
        }
      });
    });
    return connections;
  }, [candidate, savedConditionInformation, savedConditions]);

  const conditionLoadFailed = savedConditions.some(
    (condition) => savedConditionInformation[condition.entity_id]?.status === 'error',
  );

  const candidateTopics = useMemo(() => {
    const payload = candidateReview.medicineInformation;
    if (!payload) return [];
    const topics = payload.label_information?.food_lifestyle_information?.topics;
    if (!Array.isArray(topics) || !topics.length) return [];
    const groupedTopics = new Map();
    topics.filter(Boolean).forEach((topic) => {
      const label = readableTopicName(typeof topic === 'string' ? topic : topic.topic);
      groupedTopics.set(label, (groupedTopics.get(label) || 0) + 1);
    });
    return [{
      label: 'Food and lifestyle',
      topics: [...groupedTopics].map(([label, count]) => ({ label, count })),
    }];
  }, [candidateReview.medicineInformation]);

  const reviewStarted = candidateReview.checking
    || candidateReview.completed
    || candidateReview.results.length > 0;
  const visiblePairResults = showAllPairs
    ? sortedPairResults
    : sortedPairResults.slice(0, COMPACT_RESULT_COUNT);

  function handleCandidateSelect(nextCandidate) {
    reviewIdRef.current += 1;
    setCandidate(nextCandidate);
    setShowAllPairs(false);
    setCandidateReview({
      checking: false,
      completed: false,
      current: 0,
      total: 0,
      results: [],
      medicineInformationStatus: 'idle',
      medicineInformation: null,
    });
  }

  async function checkCandidate() {
    if (!candidate || candidateReview.checking) return;

    const reviewId = reviewIdRef.current + 1;
    reviewIdRef.current = reviewId;
    setShowAllPairs(false);

    const pairs = eligibleSavedMedicines.map((savedMedicine, originalIndex) => ({
      savedMedicine,
      candidate,
      originalIndex,
    }));

    setCandidateReview({
      checking: true,
      completed: false,
      current: 0,
      total: pairs.length,
      results: [],
      medicineInformationStatus: 'loading',
      medicineInformation: null,
    });

    const knownMedicinePayload = savedMedicineInformation[candidate.entity_id]?.payload;
    const medicineInformationPromise = (knownMedicinePayload
      ? Promise.resolve(knownMedicinePayload)
      : getJson(`/api/public/medicine?drug_id=${encodeURIComponent(candidate.entity_id)}`))
      .then((payload) => {
        if (reviewIdRef.current !== reviewId) return;
        setCandidateReview((current) => ({
          ...current,
          medicineInformationStatus: 'ready',
          medicineInformation: payload,
        }));
      })
      .catch(() => {
        if (reviewIdRef.current !== reviewId) return;
        setCandidateReview((current) => ({
          ...current,
          medicineInformationStatus: 'error',
          medicineInformation: null,
        }));
      });

    const pairReviewPromise = mapWithConcurrency(
      pairs,
      MAX_CONCURRENT_REQUESTS,
      (pair) => getJson(
        pairEndpoint(
          '/api/evidence/pair',
          pair.savedMedicine.entity_id,
          pair.candidate.entity_id,
        ),
      ),
      (settled, originalIndex) => {
        if (reviewIdRef.current !== reviewId) return;
        const pair = pairs[originalIndex];
        const failed = settled.status === 'rejected';
        const evidence = failed ? null : settled.value;
        const result = {
          ...pair,
          failed,
          status: derivePairReviewStatus(evidence, failed).key,
        };
        setCandidateReview((current) => ({
          ...current,
          current: current.current + 1,
          results: [...current.results, result],
        }));
      },
      () => reviewIdRef.current !== reviewId,
    );

    await Promise.all([pairReviewPromise, medicineInformationPromise]);

    if (reviewIdRef.current === reviewId) {
      setCandidateReview((current) => ({
        ...current,
        checking: false,
        completed: true,
      }));
    }
  }

  return (
    <div className="page my-health-page">
      <header className="my-health-header">
        <p className="eyebrow">MY HEALTH</p>
        <h1>Check a medicine with your saved health information</h1>
        <p className="my-health-header__summary">
          Review available information for a medicine against the medicines and conditions you&apos;ve saved.
        </p>
        <p className="my-health-privacy-note">
          <Info size={15} aria-hidden="true" />
          Saved only in this browser. CHEERS organizes available information and does not provide diagnosis or treatment advice.
        </p>
      </header>

      <section className="health-context-surface" aria-labelledby="health-context-title">
        <div className="health-section-heading health-section-heading--compact">
          <div>
            <p className="health-section-kicker">SAVED CONTEXT</p>
            <h2 id="health-context-title">Your health context</h2>
          </div>
        </div>
        <div className="health-context-grid">
          <ContextGroup
            title="Medicines"
            items={savedMedicines}
            emptyLabel="No medicines saved yet."
            actionLabel={savedMedicines.length ? 'Manage medicines' : 'Add medicines'}
            actionTo="/my-medicines"
          />
          <ContextGroup
            title="Conditions"
            items={savedConditions}
            emptyLabel="No conditions saved yet."
            actionLabel={savedConditions.length ? 'Manage conditions' : 'Add conditions'}
            actionTo="/my-conditions"
          />
        </div>
      </section>

      <section className="health-checker" aria-labelledby="health-checker-title">
        <div className="health-checker__intro">
          <span className="health-checker__icon" aria-hidden="true">
            <SearchCheck size={24} />
          </span>
          <div>
            <p className="health-section-kicker">MEDICINE CHECK</p>
            <h2 id="health-checker-title">Check a medicine</h2>
            <p>Considering another medicine? Review available information against your saved health context.</p>
          </div>
        </div>

        <div className="health-checker__form">
          <DrugAutocomplete
            label="Medicine to check"
            selection={candidate}
            onSelect={handleCandidateSelect}
            placeholder="Search by medicine name or DrugBank ID"
          />

          {candidate ? (
            <div className="health-candidate-summary" aria-label="Selected medicine">
              <div>
                <strong>{candidate.name}</strong>
                <span>DrugBank · {candidate.entity_id}</span>
              </div>
              <p>
                Review against {eligibleSavedMedicines.length} saved medicine{eligibleSavedMedicines.length === 1 ? '' : 's'} · {savedConditions.length} saved condition{savedConditions.length === 1 ? '' : 's'}
              </p>
            </div>
          ) : null}

          <button
            className="primary-button health-checker__submit"
            type="button"
            disabled={!candidate || candidateReview.checking}
            onClick={checkCandidate}
          >
            {candidateReview.checking ? (
              <>
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
                Checking information
              </>
            ) : (
              <>
                Check medicine
                <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </section>

      {!reviewStarted ? (
        <section className="health-capabilities" aria-label="Information available in this review">
          <CapabilityTile
            Icon={Files}
            title="Medicine pairs"
            description="FDA label and PubMed source retrieval"
          />
          <CapabilityTile
            Icon={HeartPulse}
            title="Saved conditions"
            description="Existing medicine-condition relationships"
          />
          <CapabilityTile
            Icon={Pill}
            title="Medicine information"
            description="Available official label topics"
          />
        </section>
      ) : null}

      {reviewStarted && candidate ? (
        <section className="health-review-results" aria-labelledby="health-review-title">
          <header className="health-review-header">
            <div>
              <p className="health-section-kicker">REVIEW RESULTS</p>
              <h2 id="health-review-title">{candidate.name}</h2>
              <p>
                {candidateReview.completed ? 'Reviewed' : 'Reviewing'} with {eligibleSavedMedicines.length} medicine{eligibleSavedMedicines.length === 1 ? '' : 's'} · {savedConditions.length} condition{savedConditions.length === 1 ? '' : 's'}
              </p>
            </div>
            <span className="health-review-id">DrugBank · {candidate.entity_id}</span>
          </header>

          {candidateReview.checking ? (
            <p className="health-review-progress" role="status" aria-live="polite">
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
              {candidateReview.total > 0
                ? `Checked ${candidateReview.current} of ${candidateReview.total} medicine pairs`
                : 'Checking available medicine information'}
            </p>
          ) : null}

          <div className="health-review-layout">
            {eligibleSavedMedicines.length > 0 ? (
              <section className="health-results-primary" aria-labelledby="medicine-results-title">
                <div className="health-results-heading">
                  <div>
                    <h3 id="medicine-results-title">With your medicines</h3>
                    <p>Retrieved source information for each saved medicine pair.</p>
                  </div>
                  {candidateReview.completed ? (
                    <span>{sortedPairResults.length} checked</span>
                  ) : null}
                </div>

                <div id="health-pair-results" className="health-pair-results">
                  {visiblePairResults.map((result) => (
                    <PairResult
                      key={`${result.savedMedicine.entity_id}:${result.candidate.entity_id}`}
                      result={result}
                    />
                  ))}
                </div>

                {sortedPairResults.length > COMPACT_RESULT_COUNT ? (
                  <div className="health-result-toggle-row">
                    <span>
                      Showing {visiblePairResults.length} of {sortedPairResults.length} reviewed medicine pairs
                    </span>
                    <button
                      className="button button--ghost health-result-toggle"
                      type="button"
                      aria-expanded={showAllPairs}
                      aria-controls="health-pair-results"
                      onClick={() => setShowAllPairs((current) => !current)}
                    >
                      {showAllPairs ? 'Show fewer' : `Show all ${sortedPairResults.length} medicine pairs`}
                    </button>
                  </div>
                ) : null}

                {candidateReview.results.length > 0 ? (
                  <p className="health-pair-limitation">
                    These statuses summarize retrieved sources. They do not determine interaction severity, probability, or personal safety. Missing information is not proof of safety.
                  </p>
                ) : null}
              </section>
            ) : null}

            <div className="health-results-supporting">
              {savedConditions.length > 0 ? (
                <section className="health-support-section" aria-labelledby="condition-results-title">
                  <div className="health-results-heading">
                    <div>
                      <h3 id="condition-results-title">With your conditions</h3>
                      <p>Relationships recorded in the checked CHEERS data.</p>
                    </div>
                  </div>

                  {savedConditionsLoading ? (
                    <p className="health-inline-state" role="status">
                      <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      Checking saved condition information
                    </p>
                  ) : conditionConnections.length > 0 ? (
                    <div className="health-condition-results">
                      {conditionConnections.map((connection) => (
                        <article
                          className="health-condition-result"
                          key={`${connection.condition.entity_id}:${connection.relation}`}
                        >
                          <h4>{connection.condition.name}</h4>
                          <p>{connection.relation}</p>
                          <Link className="health-result-link" to={`/diseases/${encodeURIComponent(connection.condition.entity_id)}`}>
                            View condition information
                            <ArrowRight size={14} aria-hidden="true" />
                          </Link>
                        </article>
                      ))}
                    </div>
                  ) : candidateReview.completed && conditionLoadFailed ? (
                    <p className="health-inline-state health-inline-state--error">
                      Some saved condition information could not be loaded.
                    </p>
                  ) : candidateReview.completed ? (
                    <div className="health-bounded-empty">
                      <p>No recorded medicine–condition relationship was found in the checked CHEERS data.</p>
                      <p>This does not establish that the medicine is safe or appropriate for the condition.</p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {candidateReview.medicineInformationStatus === 'ready' && candidateTopics.length > 0 ? (
                <section className="health-support-section" aria-labelledby="medicine-information-title">
                  <div className="health-results-heading">
                    <div>
                      <h3 id="medicine-information-title">Other available information</h3>
                      <p>Topics retrieved for {candidate.name}.</p>
                    </div>
                  </div>
                  <div className="health-topic-groups">
                    {candidateTopics.map((group) => (
                      <div className="health-topic-group" key={group.label}>
                        <h4>{group.label}</h4>
                        <ul>
                          {group.topics.map((topic) => (
                            <li key={topic.label}>
                              <strong>{topic.label}</strong>
                              <span>
                                {topic.count} official label {topic.count === 1 ? 'excerpt' : 'excerpts'} available
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <Link className="health-result-link" to={`/medicines/${encodeURIComponent(candidate.entity_id)}`}>
                    View medicine information
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default MyHealth;
