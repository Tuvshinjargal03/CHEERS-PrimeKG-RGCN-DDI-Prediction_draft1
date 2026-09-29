import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAVED_MEDICINES_STORAGE_KEY } from '../lib/myMedicines.js';
import MyHealth from './MyHealth.jsx';

const CONDITIONS_KEY = 'cheers.my-conditions.v1';
const METFORMIN = { entity_id: 'DB00331', name: 'Metformin' };
const WARFARIN = { entity_id: 'DB00682', name: 'Warfarin' };
const DIABETES = { entity_id: '5148', name: 'Type 2 diabetes mellitus' };

function save(key, items) { window.localStorage.setItem(key, JSON.stringify(items)); }
function LocationProbe() { const location = useLocation(); return <output aria-label="Current location">{location.pathname}{location.search}</output>; }
function renderPage() { return render(<MemoryRouter><MyHealth /><LocationProbe /></MemoryRouter>); }

describe('My Health dashboard', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows a useful empty state while keeping all four dashboard sections visible', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'My Health' })).toBeVisible();
    expect(screen.getByText('Saved on this device.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Add medicines or conditions to keep useful information together.' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add medicine' })).toHaveAttribute('href', '/my-medicines');
    expect(screen.getByRole('link', { name: 'Add condition' })).toHaveAttribute('href', '/my-conditions');
    expect(screen.getByRole('heading', { name: 'My medicines' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'My conditions' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Things to review' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Ask CHEERS' })).toBeVisible();
    expect(screen.getByText('Saved items are not attached automatically.', { exact: false })).toBeVisible();
    const savedGrid = document.querySelector('.my-health-saved-grid');
    expect(savedGrid.querySelectorAll('.my-health-panel.is-empty')).toHaveLength(2);
    expect(savedGrid.nextElementSibling).toHaveClass('my-health-reviews');
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveAttribute('placeholder', 'Ask about one of your saved medicines or conditions...');
    expect(document.body).not.toHaveTextContent(/saved context|health context/i);
  });

  it('shows one saved medicine with readable actions and no prominent database ID', () => {
    save(SAVED_MEDICINES_STORAGE_KEY, [METFORMIN]);
    renderPage();
    expect(screen.getAllByText('Metformin').length).toBeGreaterThan(0);
    expect(screen.queryByText('DB00331')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View information' })).toHaveAttribute('href', '/medicines/DB00331');
    expect(screen.getByRole('heading', { name: 'Learn more about Metformin' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View uses' })).toHaveAttribute('href', '/medicines/DB00331');
    expect(screen.getByRole('link', { name: 'View side effects' })).toHaveAttribute('href', '/search?q=Metformin%20side%20effects');
  });

  it('prefills Check Medicines with both saved medicines', () => {
    save(SAVED_MEDICINES_STORAGE_KEY, [METFORMIN, WARFARIN]);
    renderPage();
    const card = screen.getByRole('heading', { name: 'Metformin + Warfarin' }).closest('article');
    expect(within(card).getByRole('link', { name: /Review together/ })).toHaveAttribute('href', '/check?drug_a_id=DB00331&drug_b_id=DB00682');
  });

  it('shows condition and medicine-condition actions without treatment claims', () => {
    save(SAVED_MEDICINES_STORAGE_KEY, [METFORMIN]);
    save(CONDITIONS_KEY, [DIABETES]);
    renderPage();
    expect(screen.getAllByText(DIABETES.name).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View condition information' })).toHaveAttribute('href', '/diseases/5148');
    const card = screen.getByRole('heading', { name: `Metformin + ${DIABETES.name}` }).closest('article');
    expect(within(card).getByRole('link', { name: /Explore relationship information/ })).toHaveAttribute('href', '/search?q=Metformin%20and%20Type%202%20diabetes%20mellitus');
    expect(document.body).not.toHaveTextContent(/recommended treatment|safe for you/i);
    expect(screen.getByText(/does not diagnose or choose treatment for you/i)).toBeVisible();
  });

  it('bounds deterministic pair suggestions without requesting network data', async () => {
    const user = userEvent.setup();
    save(SAVED_MEDICINES_STORAGE_KEY, Array.from({ length: 5 }, (_, index) => ({ entity_id: `DB${index}`, name: `Medicine ${index}` })));
    const fetchBefore = globalThis.fetch;
    renderPage();
    expect(screen.getAllByRole('link', { name: /Review together/ })).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'View more' }));
    expect(screen.getAllByRole('link', { name: /Review together/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  it('removes items, persists the removal, deduplicates, and fails safely on corrupted storage', async () => {
    const user = userEvent.setup();
    save(SAVED_MEDICINES_STORAGE_KEY, [METFORMIN]);
    save(CONDITIONS_KEY, [DIABETES]);
    const first = renderPage();
    await user.click(screen.getByRole('button', { name: 'Remove Metformin' }));
    expect(JSON.parse(window.localStorage.getItem(SAVED_MEDICINES_STORAGE_KEY))).toEqual([]);
    first.unmount();
    renderPage();
    expect(screen.queryByRole('button', { name: 'Remove Metformin' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Remove ${DIABETES.name}` })).toBeVisible();
    window.localStorage.setItem(CONDITIONS_KEY, '{broken');
    save(SAVED_MEDICINES_STORAGE_KEY, [METFORMIN, METFORMIN]);
    document.body.innerHTML = '';
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Remove Metformin' })).toHaveLength(1);
    expect(screen.getByText('No conditions saved yet.')).toBeVisible();
  });

  it('sends only the explicitly entered question to Ask CHEERS', async () => {
    const user = userEvent.setup();
    save(SAVED_MEDICINES_STORAGE_KEY, [METFORMIN]);
    save(CONDITIONS_KEY, [DIABETES]);
    renderPage();
    const question = screen.getByRole('textbox', { name: 'Question' });
    expect(question).toHaveAttribute('placeholder', 'Ask about one of your saved medicines or conditions...');
    await user.type(question, 'Metformin side effects?');
    await user.click(screen.getByRole('button', { name: 'Ask CHEERS' }));
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/search?q=Metformin%20side%20effects%3F');
    expect(screen.getByLabelText('Current location')).not.toHaveTextContent('diabetes');
  });
});
