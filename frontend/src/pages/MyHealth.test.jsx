import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getJson } from '../lib/api.js';
import { SAVED_MEDICINES_STORAGE_KEY } from '../lib/myMedicines.js';
import MyHealth from './MyHealth.jsx';

vi.mock('../lib/api.js', () => ({
  getJson: vi.fn(),
  pairEndpoint: vi.fn((path, drugAId, drugBId) => `${path}?drug_a_id=${drugAId}&drug_b_id=${drugBId}`),
}));

const WARFARIN = { entity_id: 'DB00682', name: 'Warfarin', node_id: 682 };
const METFORMIN = { entity_id: 'DB00331', name: 'Metformin', node_id: 331 };
const IBUPROFEN = { entity_id: 'DB01050', name: 'Ibuprofen', node_id: 1050 };
const ASPIRIN = { entity_id: 'DB00945', name: 'Aspirin', node_id: 945 };
const DIABETES = { entity_id: '5148', name: 'type 2 diabetes mellitus' };
const GOUT = { entity_id: '5393', name: 'gout' };
const SEARCH_ITEMS = [WARFARIN, METFORMIN, IBUPROFEN, ASPIRIN];

function medicinePayload(medicine, topics = []) {
  return {
    drug: { drug_id: medicine.entity_id, drug_name: medicine.name },
    label_information: {
      status: 'ok',
      food_lifestyle_information: {
        status: topics.length ? 'available' : 'no_explicit_mentions',
        topics: topics.map((topic) => ({
          topic,
          excerpt: `${topic.replaceAll('_', ' ')} information from the checked official label.`,
        })),
      },
    },
  };
}

function diseasePayload(condition, relationships = []) {
  return {
    disease: { entity_id: condition.entity_id, name: condition.name },
    medicine_relationships: {
      indications: relationships.filter((relationship) => relationship.group === 'indications'),
      other: relationships.filter((relationship) => relationship.group !== 'indications'),
    },
  };
}

const DIABETES_PAYLOAD = diseasePayload(DIABETES, [
  {
    group: 'indications',
    drug_id: METFORMIN.entity_id,
    drug_name: METFORMIN.name,
    relation: 'indication',
  },
  {
    group: 'other',
    drug_id: IBUPROFEN.entity_id,
    drug_name: IBUPROFEN.name,
    relation: 'off-label use',
  },
]);

function pairPayload({ important = false, literature = false } = {}) {
  return {
    label_evidence: {
      evidence_found: important,
      pair_evidence: important ? [{ section: 'warnings' }] : [],
    },
    literature: { papers: literature ? [{ pmid: '12345' }] : [] },
  };
}

function installDefaultApi() {
  getJson.mockImplementation((path) => {
    if (path.startsWith('/api/drugs/search')) {
      const query = new URLSearchParams(path.split('?')[1]).get('q')?.toLowerCase() || '';
      return Promise.resolve({
        results: SEARCH_ITEMS.filter((item) => item.name.toLowerCase().includes(query)),
        has_more: false,
      });
    }
    if (path.startsWith('/api/public/medicine')) {
      if (path.includes(WARFARIN.entity_id)) return Promise.resolve(medicinePayload(WARFARIN, ['vitamin_k']));
      if (path.includes(METFORMIN.entity_id)) return Promise.resolve(medicinePayload(METFORMIN, ['alcohol', 'food_or_meals']));
      if (path.includes(IBUPROFEN.entity_id)) return Promise.resolve(medicinePayload(IBUPROFEN));
      return Promise.resolve(medicinePayload(ASPIRIN, ['food_or_meals']));
    }
    if (path.startsWith('/api/public/disease')) {
      if (path.includes(DIABETES.entity_id)) return Promise.resolve(DIABETES_PAYLOAD);
      return Promise.resolve(diseasePayload(GOUT));
    }
    if (path.includes(WARFARIN.entity_id)) return Promise.resolve(pairPayload({ important: true }));
    if (path.includes(METFORMIN.entity_id)) return Promise.resolve(pairPayload({ literature: true }));
    return Promise.resolve(pairPayload());
  });
}

function save(key, items) {
  window.localStorage.setItem(key, JSON.stringify(items));
}

function renderPage() {
  return render(<MemoryRouter><MyHealth /></MemoryRouter>);
}

async function selectCandidate(user, candidate) {
  const input = screen.getByRole('combobox', { name: 'Medicine to check' });
  await user.click(input);
  await user.type(input, candidate.name);
  const option = await screen.findByRole('option', { name: new RegExp(candidate.name, 'i') });
  await user.click(option);
  return input;
}

describe('My Health candidate review workspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getJson.mockReset();
  });

  it('keeps an empty context concise while leaving the medicine checker usable', () => {
    installDefaultApi();
    renderPage();

    expect(screen.getByRole('heading', { name: 'Check a medicine with your saved health information' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your health context' })).toBeVisible();
    expect(screen.getByText('No medicines saved yet.')).toBeVisible();
    expect(screen.getByText('No conditions saved yet.')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Medicine to check' })).toHaveAttribute(
      'placeholder',
      'Search by medicine name or DrugBank ID',
    );
    expect(screen.getByRole('button', { name: 'Check medicine' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Medicine pairs' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Saved conditions' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Medicine information' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'With your medicines' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'With your conditions' })).not.toBeInTheDocument();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('uses saved conditions without rendering an empty medicine-result list', async () => {
    const user = userEvent.setup();
    save('cheers.my-conditions.v1', [DIABETES]);
    installDefaultApi();
    renderPage();

    expect(screen.getByText(DIABETES.name)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add medicines' })).toHaveAttribute('href', '/my-medicines');
    await selectCandidate(user, IBUPROFEN);
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));

    expect(await screen.findByRole('heading', { name: 'With your conditions' })).toBeVisible();
    expect(screen.getByText('off-label use')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View condition information' })).toHaveAttribute(
      'href',
      `/diseases/${DIABETES.entity_id}`,
    );
    expect(screen.queryByRole('heading', { name: 'With your medicines' })).not.toBeInTheDocument();
    expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false);
  });

  it('shows saved medicines but does not request pair evidence before Check medicine', async () => {
    const user = userEvent.setup();
    save(SAVED_MEDICINES_STORAGE_KEY, [WARFARIN, METFORMIN]);
    installDefaultApi();
    renderPage();

    expect(screen.getByText(WARFARIN.name)).toBeVisible();
    expect(screen.getByText(METFORMIN.name)).toBeVisible();
    await waitFor(() => expect(
      getJson.mock.calls.filter(([path]) => path.startsWith('/api/public/medicine')),
    ).toHaveLength(2));
    expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false);

    await selectCandidate(user, ASPIRIN);
    expect(screen.getByText('DrugBank · DB00945')).toBeVisible();
    expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));
    await waitFor(() => expect(
      getJson.mock.calls.filter(([path]) => path.startsWith('/api/evidence/pair')),
    ).toHaveLength(2));
  });

  it('keeps the candidate separate from saved medicines and excludes self-pairs', async () => {
    const user = userEvent.setup();
    save(SAVED_MEDICINES_STORAGE_KEY, [ASPIRIN, WARFARIN]);
    installDefaultApi();
    renderPage();

    const before = window.localStorage.getItem(SAVED_MEDICINES_STORAGE_KEY);
    const input = await selectCandidate(user, ASPIRIN);
    expect(input).toHaveValue(ASPIRIN.name);
    expect(screen.getByLabelText('Selected medicine')).toHaveTextContent('DrugBank · DB00945');
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));

    await waitFor(() => expect(
      getJson.mock.calls.filter(([path]) => path.startsWith('/api/evidence/pair')),
    ).toHaveLength(1));
    expect(getJson.mock.calls.find(([path]) => path.startsWith('/api/evidence/pair'))[0]).toBe(
      '/api/evidence/pair?drug_a_id=DB00682&drug_b_id=DB00945',
    );
    expect(window.localStorage.getItem(SAVED_MEDICINES_STORAGE_KEY)).toBe(before);
  });

  it('uses four workers, isolates failures, orders completed results deterministically, and expands without fetching', async () => {
    const user = userEvent.setup();
    const savedMedicines = Array.from({ length: 8 }, (_, index) => ({
      entity_id: `TEST${index}`,
      name: `Medicine ${index}`,
    }));
    save(SAVED_MEDICINES_STORAGE_KEY, savedMedicines);
    installDefaultApi();
    const defaultApi = getJson.getMockImplementation();
    const pending = [];
    let active = 0;
    let peak = 0;
    getJson.mockImplementation((path) => {
      if (!path.startsWith('/api/evidence/pair')) return defaultApi(path);
      active += 1;
      peak = Math.max(peak, active);
      const request = { path, settled: false };
      pending.push(request);
      return new Promise((resolve, reject) => {
        request.finish = ({ failed = false, important = false, literature = false } = {}) => {
          request.settled = true;
          if (failed) reject(new Error('fixture unavailable'));
          else resolve(pairPayload({ important, literature }));
        };
      }).finally(() => { active -= 1; });
    });
    renderPage();
    await waitFor(() => expect(
      getJson.mock.calls.filter(([path]) => path.startsWith('/api/public/medicine')),
    ).toHaveLength(8));
    await selectCandidate(user, ASPIRIN);
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));

    expect(pending).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('Checked 0 of 8 medicine pairs');
    await act(async () => { pending[3].finish({ failed: true }); });
    expect(pending).toHaveLength(5);
    expect(screen.getByRole('status')).toHaveTextContent('Checked 1 of 8 medicine pairs');
    await act(async () => { pending[1].finish({ important: true }); });
    await act(async () => { pending[0].finish(); });
    await act(async () => { pending[2].finish({ literature: true }); });

    while (pending.some((request) => !request.settled)) {
      await act(async () => { pending.find((request) => !request.settled).finish(); });
      expect(active).toBeLessThanOrEqual(4);
    }

    expect(peak).toBe(4);
    expect(pending).toHaveLength(8);
    expect(new Set(pending.map((request) => request.path)).size).toBe(8);
    const list = document.getElementById('health-pair-results');
    let cards = [...list.children];
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('Medicine 1');
    expect(cards[0]).toHaveTextContent('Interaction information found');
    expect(cards[1]).toHaveTextContent('Medicine 2');
    expect(cards[1]).toHaveTextContent('Literature found');
    expect(cards[2]).toHaveTextContent('Medicine 0');
    expect(screen.getByText('Showing 3 of 8 reviewed medicine pairs')).toBeVisible();
    const requestCount = getJson.mock.calls.length;
    const showAll = screen.getByRole('button', { name: 'Show all 8 medicine pairs' });
    expect(showAll).toHaveAttribute('aria-expanded', 'false');
    expect(showAll).toHaveAttribute('aria-controls', 'health-pair-results');
    await user.click(showAll);
    cards = [...list.children];
    expect(cards).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Source information unavailable')).toBeInTheDocument();
    expect(getJson).toHaveBeenCalledTimes(requestCount);
    expect(screen.getAllByRole('link', { name: 'Review evidence' })[0]).toHaveAttribute(
      'href',
      '/evidence?drug_a_id=TEST1&drug_b_id=DB00945',
    );
    expect(screen.getByText(/do not determine interaction severity, probability, or personal safety/i)).toBeVisible();
    expect(screen.getByText(/Missing information is not proof of safety/i)).toBeVisible();
  });

  it('shows exact saved-condition relationships and a bounded no-relationship state', async () => {
    const user = userEvent.setup();
    save('cheers.my-conditions.v1', [DIABETES, GOUT]);
    installDefaultApi();
    renderPage();

    await selectCandidate(user, ASPIRIN);
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));

    expect(await screen.findByText('No recorded medicine–condition relationship was found in the checked CHEERS data.')).toBeVisible();
    expect(screen.getByText('This does not establish that the medicine is safe or appropriate for the condition.')).toBeVisible();
    expect(screen.queryByText(/treatment indication/i)).not.toBeInTheDocument();
  });

  it('shows candidate official-label topics when available and hides the section when unavailable', async () => {
    const user = userEvent.setup();
    installDefaultApi();
    const { unmount } = renderPage();

    await selectCandidate(user, METFORMIN);
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));
    expect(await screen.findByRole('heading', { name: 'Other available information' })).toBeVisible();
    expect(screen.getByText('Alcohol')).toBeVisible();
    expect(screen.getByText('Food or meals')).toBeVisible();
    expect(screen.getAllByText('1 official label excerpt available')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'View medicine information' })).toHaveAttribute(
      'href',
      `/medicines/${METFORMIN.entity_id}`,
    );

    unmount();
    getJson.mockReset();
    installDefaultApi();
    renderPage();
    await selectCandidate(user, IBUPROFEN);
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: IBUPROFEN.name })).toBeVisible());
    expect(screen.queryByRole('heading', { name: 'Other available information' })).not.toBeInTheDocument();
  });

  it('clears old results when the candidate changes and ignores a stale pair response', async () => {
    const user = userEvent.setup();
    save(SAVED_MEDICINES_STORAGE_KEY, [WARFARIN]);
    installDefaultApi();
    const defaultApi = getJson.getMockImplementation();
    let finishOldPair;
    getJson.mockImplementation((path) => {
      if (path === '/api/evidence/pair?drug_a_id=DB00682&drug_b_id=DB00945') {
        return new Promise((resolve) => { finishOldPair = resolve; });
      }
      return defaultApi(path);
    });
    renderPage();

    await selectCandidate(user, ASPIRIN);
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));
    await waitFor(() => expect(finishOldPair).toBeTypeOf('function'));
    await user.click(screen.getByRole('button', { name: 'Clear Medicine to check' }));
    await user.type(screen.getByRole('combobox', { name: 'Medicine to check' }), IBUPROFEN.name);
    await user.click(await screen.findByRole('option', { name: /Ibuprofen/i }));
    expect(screen.queryByRole('heading', { name: 'With your medicines' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check medicine' }));
    expect(await screen.findByRole('heading', { name: IBUPROFEN.name })).toBeVisible();
    await act(async () => { finishOldPair(pairPayload({ important: true })); });
    expect(screen.getByRole('heading', { name: IBUPROFEN.name })).toBeVisible();
    expect(screen.queryByText('With Aspirin')).not.toBeInTheDocument();
  });

  it('limits saved-item loaders to four concurrent requests and does not publish after unmount', async () => {
    const savedMedicines = Array.from({ length: 6 }, (_, index) => ({
      entity_id: `SAVED${index}`,
      name: `Saved medicine ${index}`,
    }));
    save(SAVED_MEDICINES_STORAGE_KEY, savedMedicines);
    const pending = [];
    let active = 0;
    let peak = 0;
    getJson.mockImplementation((path) => {
      active += 1;
      peak = Math.max(peak, active);
      const request = { path, settled: false };
      pending.push(request);
      return new Promise((resolve) => {
        request.finish = () => {
          request.settled = true;
          resolve(medicinePayload(ASPIRIN));
        };
      }).finally(() => { active -= 1; });
    });
    const { unmount } = renderPage();

    expect(pending).toHaveLength(4);
    await act(async () => { pending[0].finish(); });
    expect(pending).toHaveLength(5);
    expect(peak).toBe(4);
    unmount();
    await act(async () => {
      pending.filter((request) => !request.settled).forEach((request) => request.finish());
    });
    expect(pending).toHaveLength(5);
  });

  it('uses semantic controls, a live progress region, and avoids forbidden clinical conclusions', async () => {
    const user = userEvent.setup();
    save(SAVED_MEDICINES_STORAGE_KEY, [WARFARIN]);
    installDefaultApi();
    renderPage();

    const input = await selectCandidate(user, ASPIRIN);
    expect(input).toHaveAttribute('role', 'combobox');
    expect(screen.getByRole('button', { name: 'Check medicine' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Check medicine' }));
    await screen.findByRole('heading', { name: 'With your medicines' });

    expect(document.body).not.toHaveTextContent(/safe to take|unsafe to take|recommended treatment|interaction probability|risk score/i);
    expect(screen.getByText(/does not provide diagnosis or treatment advice/i)).toBeVisible();
  });
});
