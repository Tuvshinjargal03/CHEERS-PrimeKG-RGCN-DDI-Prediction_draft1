import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, HeartPulse, MessageCircleQuestion, Pill, Plus, ShieldCheck, Stethoscope, Trash2 } from 'lucide-react';
import { MAX_SAVED_MEDICINES, SAVED_MEDICINES_STORAGE_KEY, generateUniqueMedicinePairs } from '../lib/myMedicines';
import { medicineDisplayName } from '../lib/medicineNames.js';
import './MyHealth.css';

const SAVED_CONDITIONS_STORAGE_KEY = 'cheers.my-conditions.v1';
const MAX_CONDITIONS = 8;
const INITIAL_REVIEW_COUNT = 3;
const EXPANDED_REVIEW_COUNT = 6;

function readSavedSelections(storageKey, limit) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.filter((item) => {
      if (!item || typeof item.entity_id !== 'string' || typeof item.name !== 'string') return false;
      const id = item.entity_id.trim();
      const name = item.name.trim();
      if (!id || !name || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((item) => ({ ...item, entity_id: item.entity_id.trim(), name: item.name.trim() })).slice(0, limit);
  } catch {
    return [];
  }
}

function SavedItemsPanel({ kind, items, onRemove, showAddAction }) {
  const isMedicine = kind === 'medicine';
  const title = isMedicine ? 'My medicines' : 'My conditions';
  const manageRoute = isMedicine ? '/my-medicines' : '/my-conditions';
  return (
    <section className={`my-health-panel ${items.length ? '' : 'is-empty'}`} aria-labelledby={`my-${kind}s-heading`}>
      <div className="my-health-panel__heading">
        <div><span className="my-health-panel__icon" aria-hidden="true">{isMedicine ? <Pill size={20} /> : <HeartPulse size={20} />}</span><h2 id={`my-${kind}s-heading`}>{title}</h2></div>
        <span className="my-health-count" aria-label={`${items.length} saved ${kind}${items.length === 1 ? '' : 's'}`}>{items.length}</span>
      </div>
      {items.length ? (
        <ul className="my-health-saved-list">
          {items.map((item) => {
            const displayName = isMedicine ? medicineDisplayName(item) : item.name;
            const route = isMedicine ? `/medicines/${encodeURIComponent(item.entity_id)}` : `/diseases/${encodeURIComponent(item.entity_id)}`;
            return (
              <li key={item.entity_id} className="my-health-saved-card">
                <div><strong>{displayName}</strong>{isMedicine && displayName !== item.name ? <span>{item.name}</span> : null}</div>
                <div className="my-health-card-actions">
                  <Link to={route}>View information</Link>
                  <button type="button" onClick={() => onRemove(item.entity_id)} aria-label={`Remove ${displayName}`}><Trash2 size={15} aria-hidden="true" /> Remove</button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="my-health-panel__empty">No {isMedicine ? 'medicines' : 'conditions'} saved yet.</p>}
      {showAddAction ? <Link className="my-health-add-action" to={manageRoute}><Plus size={17} aria-hidden="true" /> Add {kind}</Link> : null}
    </section>
  );
}

function ReviewCard({ icon: Icon, title, description, action, to }) {
  return (
    <article className="my-health-review-card">
      <span className="my-health-review-card__icon" aria-hidden="true"><Icon size={20} /></span>
      <div><h3>{title}</h3><p>{description}</p><Link to={to}>{action} <ArrowRight size={15} aria-hidden="true" /></Link></div>
    </article>
  );
}

export default function MyHealth() {
  const navigate = useNavigate();
  const [savedMedicines, setSavedMedicines] = useState(() => readSavedSelections(SAVED_MEDICINES_STORAGE_KEY, MAX_SAVED_MEDICINES));
  const [savedConditions, setSavedConditions] = useState(() => readSavedSelections(SAVED_CONDITIONS_STORAGE_KEY, MAX_CONDITIONS));
  const [showMorePairs, setShowMorePairs] = useState(false);
  const [showMoreRelationships, setShowMoreRelationships] = useState(false);
  const [question, setQuestion] = useState('');
  const medicinePairs = useMemo(() => generateUniqueMedicinePairs(savedMedicines), [savedMedicines]);
  const medicineConditions = useMemo(() => savedMedicines.flatMap((medicine) => savedConditions.map((condition) => ({ medicine, condition }))), [savedMedicines, savedConditions]);

  function removeSavedItem(storageKey, setter, entityId) {
    setter((current) => {
      const next = current.filter((item) => item.entity_id !== entityId);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Keep the in-page dashboard usable if browser storage is unavailable.
      }
      return next;
    });
  }

  function askCheers(event) {
    event.preventDefault();
    if (question.trim()) navigate(`/search?q=${encodeURIComponent(question.trim())}`);
  }

  const hasReviewCards = medicinePairs.length > 0 || medicineConditions.length > 0 || savedMedicines.length === 1 || savedConditions.length === 1;

  return (
    <main className="page my-health-page">
      <header className="my-health-header">
        <p className="eyebrow">PERSONAL DASHBOARD</p><h1>My Health</h1>
        <p className="my-health-header__summary">Keep your medicines and conditions together so CHEERS can organize relevant information for you.</p>
        <p className="my-health-device-note"><ShieldCheck size={16} aria-hidden="true" /> Saved on this device.</p>
        <details className="my-health-storage-details"><summary>How saving works</summary><p>Your saved medicines and conditions stay in this browser unless you remove them or clear browser data.</p></details>
      </header>

      <div className="my-health-saved-grid">
        <SavedItemsPanel kind="medicine" items={savedMedicines} showAddAction onRemove={(id) => removeSavedItem(SAVED_MEDICINES_STORAGE_KEY, setSavedMedicines, id)} />
        <SavedItemsPanel kind="condition" items={savedConditions} showAddAction onRemove={(id) => removeSavedItem(SAVED_CONDITIONS_STORAGE_KEY, setSavedConditions, id)} />
      </div>

      <section className={`my-health-reviews ${hasReviewCards ? '' : 'is-empty'}`} aria-labelledby="things-to-review-heading" aria-live="polite">
        <div className="my-health-section-heading"><div><p className="eyebrow">SAVED INFORMATION</p><h2 id="things-to-review-heading">Things to review</h2><p>Open useful CHEERS information based on the items you saved.</p></div><BookOpen size={25} aria-hidden="true" /></div>
        {hasReviewCards ? (
          <div className="my-health-review-groups">
            {medicinePairs.length ? <div className="my-health-review-group"><h3>Review your saved medicine pairs</h3><div className="my-health-review-grid">
              {medicinePairs.slice(0, showMorePairs ? EXPANDED_REVIEW_COUNT : INITIAL_REVIEW_COUNT).map(({ drugA, drugB }) => <ReviewCard key={`${drugA.entity_id}-${drugB.entity_id}`} icon={Pill} title={`${medicineDisplayName(drugA)} + ${medicineDisplayName(drugB)}`} description="Review these two saved medicines together." action="Review together" to={`/check?drug_a_id=${encodeURIComponent(drugA.entity_id)}&drug_b_id=${encodeURIComponent(drugB.entity_id)}`} />)}
            </div>{medicinePairs.length > INITIAL_REVIEW_COUNT ? <button className="my-health-more-button" type="button" onClick={() => setShowMorePairs((value) => !value)} aria-expanded={showMorePairs}>{showMorePairs ? 'Show fewer' : 'View more'}</button> : null}</div> : null}
            {medicineConditions.length ? <div className="my-health-review-group"><h3>Explore medicines and conditions</h3><div className="my-health-review-grid">
              {medicineConditions.slice(0, showMoreRelationships ? EXPANDED_REVIEW_COUNT : INITIAL_REVIEW_COUNT).map(({ medicine, condition }) => <ReviewCard key={`${medicine.entity_id}-${condition.entity_id}`} icon={Stethoscope} title={`${medicineDisplayName(medicine)} + ${condition.name}`} description="View available relationship information in CHEERS." action="Explore relationship information" to={`/search?q=${encodeURIComponent(`${medicineDisplayName(medicine)} and ${condition.name}`)}`} />)}
            </div>{medicineConditions.length > INITIAL_REVIEW_COUNT ? <button className="my-health-more-button" type="button" onClick={() => setShowMoreRelationships((value) => !value)} aria-expanded={showMoreRelationships}>{showMoreRelationships ? 'Show fewer' : 'View more'}</button> : null}</div> : null}
            {savedMedicines.length === 1 ? <div className="my-health-review-group"><h3>Learn more about {medicineDisplayName(savedMedicines[0])}</h3><div className="my-health-inline-actions"><Link to={`/medicines/${encodeURIComponent(savedMedicines[0].entity_id)}`}>View uses</Link><Link to={`/search?q=${encodeURIComponent(`${medicineDisplayName(savedMedicines[0])} side effects`)}`}>View side effects</Link></div></div> : null}
            {savedConditions.length === 1 ? <div className="my-health-review-group"><h3>Learn more about {savedConditions[0].name}</h3><div className="my-health-inline-actions"><Link to={`/diseases/${encodeURIComponent(savedConditions[0].entity_id)}`}>View condition information</Link></div></div> : null}
          </div>
        ) : <p className="my-health-reviews__empty">Add a medicine or condition to see useful review options.</p>}
      </section>

      <section className="my-health-ask" aria-labelledby="ask-saved-items-heading"><span className="my-health-ask__icon" aria-hidden="true"><MessageCircleQuestion size={23} /></span><div><h2 id="ask-saved-items-heading">Ask CHEERS</h2><p>Include a saved medicine or condition name in your question. Saved items are not attached automatically.</p><form onSubmit={askCheers} className="my-health-ask__form"><label htmlFor="saved-items-question">Question</label><input id="saved-items-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about one of your saved medicines or conditions..." /><button className="primary-button" type="submit" disabled={!question.trim()}>Ask CHEERS</button></form></div></section>
      <p className="my-health-boundary">CHEERS can organize information around your saved medicines and conditions, but it does not diagnose or choose treatment for you.</p>
    </main>
  );
}
