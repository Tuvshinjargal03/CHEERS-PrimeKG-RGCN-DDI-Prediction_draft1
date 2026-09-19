import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import {
  generateUniqueMedicinePairs,
  REVIEW_MEDICINES_STORAGE_KEY,
  SAVED_MEDICINES_STORAGE_KEY,
} from '../lib/myMedicines.js'
import MyHealth from './MyHealth.jsx'

vi.mock('../lib/api.js', () => ({
  getJson: vi.fn(),
  pairEndpoint: vi.fn((path, drugAId, drugBId) => `${path}?drug_a_id=${drugAId}&drug_b_id=${drugBId}`),
}))

const WARFARIN = { entity_id: 'DB00682', name: 'Warfarin' }
const METFORMIN = { entity_id: 'DB00331', name: 'Metformin' }
const IBUPROFEN = { entity_id: 'DB01050', name: 'Ibuprofen' }
const DIABETES = { entity_id: '5148', name: 'type 2 diabetes mellitus' }
const GOUT = { entity_id: '5393', name: 'gout' }
const INFLUENZA = { entity_id: '5812', name: 'influenza' }
const TWENTY_MEDICINES = Array.from({ length: 20 }, (_, index) => ({
  entity_id: `TEST${index}`,
  name: `Medicine ${index}`,
}))

function medicinePayload(medicine, topics = []) {
  return {
    drug: { drug_id: medicine.entity_id, drug_name: medicine.name },
    label_information: {
      food_lifestyle_information: {
        status: topics.length ? 'available' : 'no_explicit_mentions',
        topics: topics.map((topic) => ({ topic })),
      },
    },
  }
}

function diseasePayload(condition, { nutrition = false, relationships = true } = {}) {
  return {
    disease: { entity_id: condition.entity_id, name: condition.name },
    medicine_relationships: relationships ? {
      indications: [{ drug_id: 'DB00331', drug_name: 'Metformin', relation: 'indication' }],
      other: [
        { drug_id: 'DB00682', drug_name: 'Warfarin', relation: 'contraindication' },
        { drug_id: 'DB01050', drug_name: 'Ibuprofen', relation: 'off-label use' },
      ],
    } : { indications: [], other: [] },
    nutrition_lifestyle: nutrition ? {
      status: 'available',
      source: {
        organization: condition.entity_id === '5393'
          ? 'National Institute of Arthritis and Musculoskeletal and Skin Diseases (NIAMS)'
          : 'National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)',
      },
    } : { status: 'unavailable' },
  }
}

function installDefaultApi() {
  getJson.mockImplementation((path) => {
    if (path.includes('/api/public/medicine')) {
      if (path.includes('DB00682')) return Promise.resolve(medicinePayload(WARFARIN, ['vitamin_k']))
      if (path.includes('DB00331')) return Promise.resolve(medicinePayload(METFORMIN, ['alcohol', 'food_or_meals']))
      return Promise.resolve(medicinePayload(IBUPROFEN, ['food_or_meals']))
    }
    if (path.includes('/api/public/disease')) {
      if (path.includes('5393')) return Promise.resolve(diseasePayload(GOUT, { nutrition: true, relationships: false }))
      if (path.includes('5812')) return Promise.resolve(diseasePayload(INFLUENZA, { relationships: false }))
      return Promise.resolve(diseasePayload(DIABETES, { nutrition: true }))
    }
    if (path.includes('DB00682') && path.includes('DB01050')) {
      return Promise.resolve({
        label_evidence: { evidence_found: true, pair_evidence: [{ section: 'warnings' }] },
        literature: { papers: [] },
      })
    }
    if (path.includes('DB00331') && path.includes('DB01050')) {
      return Promise.resolve({
        label_evidence: { evidence_found: false, pair_evidence: [] },
        literature: { papers: [{ pmid: 'fixture' }] },
      })
    }
    return Promise.resolve({
      label_evidence: { evidence_found: false, pair_evidence: [] },
      literature: { papers: [] },
    })
  })
}

function save(key, items) {
  window.localStorage.setItem(key, JSON.stringify(items))
}

function renderPage() {
  return render(<MemoryRouter><MyHealth /></MemoryRouter>)
}

const savedInformationCases = [
  {
    kind: 'medicine',
    storageKey: 'cheers.my-medicines.v1',
    endpoint: '/api/public/medicine?drug_id=',
    route: '/medicines/',
    linkName: 'View Food & lifestyle',
    section: 'food-lifestyle',
    payload: (item, index) => medicinePayload(item, [index === 3 ? 'vitamin_k' : 'alcohol']),
    marker: (index) => index === 3 ? 'Vitamin K information available' : 'Alcohol information available',
  },
  {
    kind: 'condition',
    storageKey: 'cheers.my-conditions.v1',
    endpoint: '/api/public/disease?disease_id=',
    route: '/diseases/',
    linkName: 'View Nutrition & lifestyle',
    section: 'nutrition-lifestyle',
    payload: (item, index) => ({
      ...diseasePayload(item, { relationships: false }),
      nutrition_lifestyle: { status: 'available', source: { organization: `Source ${index}` } },
    }),
    marker: (index) => `Source: Source ${index}`,
  },
]

function deferredSavedInformation(testCase) {
  const items = Array.from({ length: 6 }, (_, index) => ({
    entity_id: `SAVED${index}`, name: `Saved ${testCase.kind} ${index}`,
  }))
  save(testCase.storageKey, items)
  const pending = []
  const activity = { active: 0, peak: 0 }
  getJson.mockImplementation((path) => {
    activity.active += 1
    activity.peak = Math.max(activity.peak, activity.active)
    const request = { path, settled: false }
    pending.push(request)
    return new Promise((resolve, reject) => {
      request.finish = (failed = false) => {
        request.settled = true
        const index = items.findIndex((item) => path === `${testCase.endpoint}${item.entity_id}`)
        if (failed) reject(new Error('fixture unavailable'))
        else resolve(testCase.payload(items[index], index))
      }
    }).finally(() => { activity.active -= 1 })
  })
  return { items, pending, activity }
}

describe('My Health', () => {
  beforeEach(() => {
    window.localStorage.clear()
    getJson.mockReset()
  })

  it('shows friendly onboarding without creating a profile store', () => {
    installDefaultApi()
    renderPage()

    expect(screen.getByRole('heading', { name: 'Build your CHEERS health view' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Add medicines' })).toHaveAttribute('href', '/my-medicines')
    expect(screen.getByRole('link', { name: 'Add conditions' })).toHaveAttribute('href', '/my-conditions')
    expect(getJson).not.toHaveBeenCalled()
    expect(Object.keys(window.localStorage)).toEqual([])
  })

  it('reads the existing medicine store and surfaces compact food/lifestyle availability', async () => {
    save('cheers.my-medicines.v1', [WARFARIN])
    installDefaultApi()
    renderPage()

    expect(screen.getByRole('heading', { name: 'My medicines' })).toBeVisible()
    expect(screen.getByRole('link', { name: /WarfarinDB00682/ })).toHaveAttribute('href', '/medicines/DB00682')
    expect(await screen.findByText('Vitamin K information available')).toBeVisible()
    expect(screen.getByRole('link', { name: 'View Food & lifestyle' })).toHaveAttribute(
      'href',
      '/medicines/DB00682?section=food-lifestyle',
    )
    expect(window.localStorage.getItem('cheers.my-health.v1')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'My medicines' })).getByRole('link', { name: 'Manage medicines' })).toHaveAttribute('href', '/my-medicines')
    expect(within(screen.getByRole('region', { name: 'My conditions' })).getByRole('link', { name: 'Manage conditions' })).toHaveAttribute('href', '/my-conditions')
    expect(screen.getByText(/Saved medicines:/)).toBeVisible()
    expect(screen.getByText(/Saved conditions:/)).toBeVisible()
  })

  it('uses all twenty saved medicines for normal information and the first eight for legacy review selection', async () => {
    save(SAVED_MEDICINES_STORAGE_KEY, TWENTY_MEDICINES)
    installDefaultApi()
    renderPage()

    expect(screen.getByRole('link', { name: /Medicine 19TEST19/ })).toHaveAttribute('href', '/medicines/TEST19')
    expect(screen.getByText('8 of 20 saved medicines selected for combination review. Manage this review set in My Medicines; unselected medicines remain saved and available elsewhere in My Health.')).toBeVisible()
    expect(screen.getByText('Review 28 combinations using the same source-based statuses as My Medicines.')).toBeVisible()
    expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false)
    await waitFor(() => {
      expect(getJson.mock.calls.filter(([path]) => path.startsWith('/api/public/medicine'))).toHaveLength(20)
      expect(screen.getAllByRole('link', { name: 'View Food & lifestyle' })).toHaveLength(20)
    })
  })

  it('preserves an explicit empty review selection and prevents combination review', async () => {
    save(SAVED_MEDICINES_STORAGE_KEY, [WARFARIN, METFORMIN, IBUPROFEN])
    save(REVIEW_MEDICINES_STORAGE_KEY, [])
    installDefaultApi()
    renderPage()

    expect(screen.getByText(/0 of 3 saved medicines selected for combination review/)).toBeVisible()
    expect(screen.getByText(/Select at least two medicines in My Medicines/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Review medicine combinations' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(getJson.mock.calls.filter(([path]) => path.startsWith('/api/public/medicine'))).toHaveLength(3)
    })
    expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false)
  })

  it('reads the existing condition store and surfaces reviewed nutrition only', async () => {
    save('cheers.my-conditions.v1', [DIABETES])
    installDefaultApi()
    renderPage()

    expect(screen.getByRole('heading', { name: 'My conditions' })).toBeVisible()
    expect(screen.getByRole('link', { name: /type 2 diabetes mellitus5148/ })).toHaveAttribute('href', '/diseases/5148')
    expect(await screen.findByText('Nutrition & lifestyle information available')).toBeVisible()
    expect(screen.getByText(/NIDDK/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'View Nutrition & lifestyle' })).toHaveAttribute(
      'href',
      '/diseases/5148?section=nutrition-lifestyle',
    )
    expect(window.localStorage.getItem('cheers.my-health.v1')).toBeNull()
  })

  it('shows only existing medicine-condition relationships in separate groups', async () => {
    save('cheers.my-medicines.v1', [WARFARIN, METFORMIN, IBUPROFEN])
    save(REVIEW_MEDICINES_STORAGE_KEY, [WARFARIN.entity_id])
    save('cheers.my-conditions.v1', [DIABETES])
    installDefaultApi()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Treatment indication' })).toBeVisible()
    const indicationGroup = screen.getByRole('heading', { name: 'Treatment indication' }).parentElement
    expect(indicationGroup).toHaveTextContent('Metformin')
    expect(indicationGroup).toHaveTextContent('type 2 diabetes mellitus')
    expect(indicationGroup).toHaveTextContent('Indication')

    const otherGroup = screen.getByRole('heading', { name: 'Other biomedical relationships' }).parentElement
    expect(otherGroup).toHaveTextContent('Warfarin')
    expect(otherGroup).toHaveTextContent('contraindication')
    expect(otherGroup).toHaveTextContent('Ibuprofen')
    expect(otherGroup).toHaveTextContent('off-label use')
    expect(screen.getByText('These are typed relationships in the checked data, not recommendations to use or change treatment.')).toBeVisible()
    expect(screen.queryByText(/no relationship with/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/recommended for you|should take|suitable|best medicine/i)).not.toBeInTheDocument()
  })

  it.each(savedInformationCases)('loads saved $kind information progressively with at most four requests', async (testCase) => {
    const { items, pending, activity } = deferredSavedInformation(testCase)
    renderPage()

    expect(pending.map(({ path }) => path)).toEqual(items.slice(0, 4).map((item) => `${testCase.endpoint}${item.entity_id}`))
    expect(activity.active).toBe(4)
    for (const item of items) {
      expect(screen.getByRole('link', { name: `${item.name}${item.entity_id}` })).toHaveAttribute('href', `${testCase.route}${item.entity_id}`)
    }
    expect(screen.queryByRole('link', { name: testCase.linkName })).not.toBeInTheDocument()

    await act(async () => { pending[3].finish() })
    expect(pending).toHaveLength(5)
    const firstAvailable = screen.getByRole('link', { name: testCase.linkName })
    expect(firstAvailable).toHaveAttribute('href', `${testCase.route}${items[3].entity_id}?section=${testCase.section}`)
    expect(firstAvailable.closest('article')).toHaveTextContent(items[3].name)
    expect(firstAvailable.closest('article')).toHaveTextContent(testCase.marker(3))
    expect(screen.getAllByText(/Loading available information/).length).toBeGreaterThan(0)

    await act(async () => { pending[1].finish(true) })
    expect(pending).toHaveLength(6)
    expect(firstAvailable).toBeVisible()
    await act(async () => { pending[0].finish() })
    expect(screen.getAllByRole('link', { name: testCase.linkName }).map((link) => link.getAttribute('href'))).toEqual(
      [items[0], items[3]].map((item) => `${testCase.route}${item.entity_id}?section=${testCase.section}`),
    )
    while (pending.some((request) => !request.settled)) {
      await act(async () => { pending.findLast((request) => !request.settled).finish() })
      expect(activity.active).toBeLessThanOrEqual(4)
    }

    expect(activity.peak).toBe(4)
    expect(activity.active).toBe(0)
    expect(pending.map(({ path }) => path)).toEqual(items.map((item) => `${testCase.endpoint}${item.entity_id}`))
    const links = screen.getAllByRole('link', { name: testCase.linkName })
    expect(links).toHaveLength(5)
    items.forEach((item, index) => {
      if (index === 1) return
      const link = links.find((entry) => entry.getAttribute('href') === `${testCase.route}${item.entity_id}?section=${testCase.section}`)
      expect(link).toBeVisible()
      expect(link.closest('article')).toHaveTextContent(item.name)
      expect(link.closest('article')).toHaveTextContent(testCase.marker(index))
    })
    expect(screen.queryByText(/Loading available information/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Some saved-item information could not be loaded/).length).toBeGreaterThan(0)
    expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false)
    expect(getJson.mock.calls.every((args) => args.length === 1)).toBe(true)
  })

  it.each(savedInformationCases)('discards stale $kind results when effects restart', async (testCase) => {
    const { pending } = deferredSavedInformation(testCase)
    // StrictMode cleans up and replays effects on the same component instance.
    render(<StrictMode><MemoryRouter><MyHealth /></MemoryRouter></StrictMode>)
    expect(pending).toHaveLength(8)

    await act(async () => {
      pending.slice(0, 4).forEach((request, index) => request.finish(index === 1))
    })
    expect(pending).toHaveLength(8)
    expect(screen.queryByRole('link', { name: testCase.linkName })).not.toBeInTheDocument()
    expect(screen.queryByText(/Some saved-item information could not be loaded/)).not.toBeInTheDocument()

    while (pending.some((request) => !request.settled)) {
      await act(async () => { pending.findLast((request) => !request.settled).finish() })
    }
    expect(pending).toHaveLength(10)
    expect(screen.getAllByRole('link', { name: testCase.linkName })).toHaveLength(6)
    expect(screen.queryByText(/Some saved-item information could not be loaded/)).not.toBeInTheDocument()
  })

  it.each(savedInformationCases.flatMap((testCase) => ['unmount', 'rerender'].map((change) => ({ ...testCase, change }))))(
    'stops queued $kind requests and ignores stale results after $change',
    async (testCase) => {
      const { items, pending } = deferredSavedInformation(testCase)
      const view = renderPage()
      expect(pending).toHaveLength(4)
      save(testCase.storageKey, [items[5]])
      if (testCase.change === 'unmount') {
        view.unmount()
        renderPage()
      } else {
        view.rerender(<MemoryRouter><MyHealth key="changed-selections" /></MemoryRouter>)
      }
      expect(pending).toHaveLength(5)
      await act(async () => { pending[4].finish() })
      await act(async () => {
        pending.slice(0, 4).forEach((request, index) => request.finish(index === 1))
      })
      expect(pending).toHaveLength(5)
      const link = screen.getByRole('link', { name: testCase.linkName })
      expect(link).toHaveAttribute('href', `${testCase.route}${items[5].entity_id}?section=${testCase.section}`)
      expect(link.closest('article')).toHaveTextContent(items[5].name)
      expect(screen.queryByRole('link', { name: `${items[0].name}${items[0].entity_id}` })).not.toBeInTheDocument()
      expect(screen.queryByText(/Some saved-item information could not be loaded/)).not.toBeInTheDocument()
      expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false)
    },
  )

  it('reviews combinations only on request and orders the existing statuses deterministically', async () => {
    const user = userEvent.setup()
    const savedMedicines = [WARFARIN, METFORMIN, IBUPROFEN, { entity_id: 'DB00945', name: 'Aspirin' }]
    save(SAVED_MEDICINES_STORAGE_KEY, savedMedicines)
    save(REVIEW_MEDICINES_STORAGE_KEY, [WARFARIN.entity_id, METFORMIN.entity_id, IBUPROFEN.entity_id])
    installDefaultApi()
    renderPage()

    await waitFor(() => expect(getJson.mock.calls.filter(([path]) => path.startsWith('/api/public/medicine'))).toHaveLength(4))
    expect(screen.getByText(/3 of 4 saved medicines selected for combination review/)).toBeVisible()
    expect(screen.getByText('Review 3 combinations using the same source-based statuses as My Medicines.')).toBeVisible()
    expect(getJson.mock.calls.some(([path]) => path.startsWith('/api/evidence/pair'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Review medicine combinations' }))

    const summary = await screen.findByLabelText('Medicine combination summary')
    expect(summary).toHaveTextContent('1interaction warnings')
    expect(summary).toHaveTextContent('1needs review')
    expect(summary).toHaveTextContent('1not enough information')
    const pairCalls = getJson.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith('/api/evidence/pair'))
    expect(pairCalls).toEqual([
      '/api/evidence/pair?drug_a_id=DB00682&drug_b_id=DB00331',
      '/api/evidence/pair?drug_a_id=DB00682&drug_b_id=DB01050',
      '/api/evidence/pair?drug_a_id=DB00331&drug_b_id=DB01050',
    ])
    const orderedPairs = screen.getByLabelText('Medicine combinations by information priority')
    expect(orderedPairs.firstElementChild).toHaveTextContent('Interaction warning found')
    expect(orderedPairs.firstElementChild).toHaveTextContent('Warfarin + Ibuprofen')
    expect(screen.getByText(/These categories summarize retrieved source information/)).toHaveTextContent(
      'not clinical severity, interaction probability, or personal-safety assessments',
    )
    expect(screen.queryByText(/health score|risk score|safe profile|unsafe profile/i)).not.toBeInTheDocument()
  })

  it('reviews 28 selected pairs from twenty saved medicines with four workers and stable priority ties', async () => {
    const user = userEvent.setup()
    const medicines = TWENTY_MEDICINES
    const reviewMedicines = medicines.slice(0, 8)
    save(SAVED_MEDICINES_STORAGE_KEY, medicines)
    save(REVIEW_MEDICINES_STORAGE_KEY, reviewMedicines.map((medicine) => medicine.entity_id))
    installDefaultApi()
    const defaultApi = getJson.getMockImplementation()
    const pending = []
    let active = 0
    let peak = 0
    getJson.mockImplementation((path) => {
      if (!path.startsWith('/api/evidence/pair')) return defaultApi(path)
      active += 1
      peak = Math.max(peak, active)
      const request = { path, settled: false }
      pending.push(request)
      return new Promise((resolve, reject) => {
        request.finish = ({ failed = false, important = false } = {}) => {
          request.settled = true
          if (failed) reject(new Error('unavailable'))
          else resolve({
            label_evidence: { evidence_found: important, pair_evidence: important ? [{}] : [] },
            literature: { papers: [] },
          })
        }
      }).finally(() => { active -= 1 })
    })
    renderPage()
    await waitFor(() => expect(getJson.mock.calls.filter(([path]) => path.startsWith('/api/public/medicine'))).toHaveLength(20))
    expect(screen.getByText(/8 of 20 saved medicines selected for combination review/)).toBeVisible()
    expect(pending).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Review medicine combinations' }))
    expect(pending).toHaveLength(4)
    expect(screen.getByText('Checked 0 of 28 combinations')).toBeVisible()
    expect(screen.queryByLabelText('Medicine combination summary')).not.toBeInTheDocument()

    await act(async () => { pending[3].finish({ failed: true }) })
    expect(pending).toHaveLength(5)
    expect(screen.getByText('Checked 1 of 28 combinations')).toBeVisible()
    expect(screen.getByText('Source request unavailable')).toBeVisible()
    await act(async () => { pending[0].finish() })
    expect(screen.getByText('Checked 2 of 28 combinations')).toBeVisible()
    let cards = [...screen.getByLabelText('Medicine combinations by information priority').children]
    expect(cards[0]).toHaveTextContent('Medicine 0 + Medicine 1')
    expect(cards[1]).toHaveTextContent('Medicine 0 + Medicine 4')

    await act(async () => { pending[1].finish({ important: true }) })
    expect(screen.getByText('Checked 3 of 28 combinations')).toBeVisible()
    cards = [...screen.getByLabelText('Medicine combinations by information priority').children]
    expect(cards[0]).toHaveTextContent('Medicine 0 + Medicine 2')
    expect(cards[0]).toHaveTextContent('Interaction warning found')
    expect(cards[1]).toHaveTextContent('Medicine 0 + Medicine 1')

    while (pending.some((request) => !request.settled)) {
      const next = pending.findLast((request) => !request.settled)
      await act(async () => { next.finish() })
      expect(active).toBeLessThanOrEqual(4)
    }
    const pairs = generateUniqueMedicinePairs(reviewMedicines)
    expect(pending.map(({ path }) => path)).toEqual(pairs.map(({ drugA, drugB }) => (
      `/api/evidence/pair?drug_a_id=${drugA.entity_id}&drug_b_id=${drugB.entity_id}`
    )))
    expect(new Set(pending.map(({ path }) => path)).size).toBe(28)
    expect(peak).toBe(4)
    expect(active).toBe(0)
    cards = [...screen.getByLabelText('Medicine combinations by information priority').children]
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveTextContent('Medicine 0 + Medicine 2')
    expect(cards[1]).toHaveTextContent('Medicine 0 + Medicine 1')
    expect(cards[2]).toHaveTextContent('Medicine 0 + Medicine 3')
    expect(screen.getByLabelText('Medicine combination summary')).toHaveTextContent('27not enough information')
    expect(screen.queryByText(/^Checked \d+ of 28 combinations$/)).not.toBeInTheDocument()
  })

  it('ignores stale completions and stops queued pairs after unmount', async () => {
    const user = userEvent.setup()
    const medicines = [WARFARIN, METFORMIN, IBUPROFEN, { entity_id: 'DB00945', name: 'Aspirin' }]
    save(SAVED_MEDICINES_STORAGE_KEY, medicines)
    installDefaultApi()
    const defaultApi = getJson.getMockImplementation()
    const settle = []
    getJson.mockImplementation((path) => (
      path.startsWith('/api/evidence/pair')
        ? new Promise((resolve) => settle.push(resolve))
        : defaultApi(path)
    ))
    const { unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Review medicine combinations' }))
    expect(settle).toHaveLength(4)
    unmount()
    save(REVIEW_MEDICINES_STORAGE_KEY, [WARFARIN.entity_id, METFORMIN.entity_id])
    renderPage()
    await act(async () => { settle.forEach((resolve) => resolve({ literature: { papers: [{}] } })) })
    expect(settle).toHaveLength(4)
    expect(screen.queryByLabelText('Medicine combination summary')).not.toBeInTheDocument()
    expect(screen.getByText(/2 of 4 saved medicines selected for combination review/)).toBeVisible()
    expect(screen.getByText('Review 1 combination using the same source-based statuses as My Medicines.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review medicine combinations' })).toBeVisible()
  })

  it('does not fabricate nutrition for an unsupported saved condition', async () => {
    save('cheers.my-conditions.v1', [INFLUENZA])
    installDefaultApi()
    renderPage()

    expect(await screen.findByText('No reviewed nutrition module is currently available for the saved conditions.')).toBeVisible()
    expect(screen.queryByText('Nutrition & lifestyle information available')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View Nutrition & lifestyle' })).not.toBeInTheDocument()
  })

  it('isolates failed medicine and condition modules while preserving other information', async () => {
    save('cheers.my-medicines.v1', [WARFARIN, METFORMIN])
    save('cheers.my-conditions.v1', [DIABETES, GOUT])
    getJson.mockImplementation((path) => {
      if (path.includes('drug_id=DB00331') || path.includes('disease_id=5393')) {
        return Promise.reject(new Error('fixture unavailable'))
      }
      if (path.includes('/api/public/medicine')) return Promise.resolve(medicinePayload(WARFARIN, ['vitamin_k']))
      return Promise.resolve(diseasePayload(DIABETES, { nutrition: true }))
    })
    renderPage()

    expect(await screen.findByText('Vitamin K information available')).toBeVisible()
    expect(await screen.findByText('Nutrition & lifestyle information available')).toBeVisible()
    expect(screen.getAllByText(/Some saved-item information could not be loaded/)).toHaveLength(3)
    expect(screen.getByRole('link', { name: /MetforminDB00331/ })).toBeVisible()
    expect(screen.getByRole('link', { name: /gout5393/ })).toBeVisible()
  })

  it('uses concise privacy boundaries without clinical scoring or recommendations', () => {
    installDefaultApi()
    renderPage()

    expect(screen.getByText(/Your selections stay on this browser/)).toBeVisible()
    expect(screen.getByText(/does not diagnose conditions, prescribe medicines, or determine personal treatment suitability/)).toBeVisible()
    expect(screen.queryByText(/compatibility score|wellness score|recommended treatment|personalized meal plan/i)).not.toBeInTheDocument()
  })
})
