import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import { generateUniqueMedicinePairs } from '../lib/myMedicines.js'
import MyMedicines from './MyMedicines.jsx'

vi.mock('../components/DrugAutocomplete.jsx', () => ({
  default: ({ label, selection, onSelect, disabled }) => {
    const medicines = [
      { entity_id: 'DB00682', name: 'Warfarin' },
      { entity_id: 'DB01050', name: 'Ibuprofen' },
      { entity_id: 'DB00331', name: 'Metformin' },
      { entity_id: 'DB00945', name: 'Acetylsalicylic acid' },
    ]

    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={selection?.entity_id || ''}
          disabled={disabled}
          onChange={(event) => {
            onSelect(medicines.find((medicine) => medicine.entity_id === event.target.value) || null)
          }}
        >
          <option value="">Choose a medicine</option>
          {medicines.map((medicine) => (
            <option key={medicine.entity_id} value={medicine.entity_id}>{medicine.name}</option>
          ))}
        </select>
      </label>
    )
  },
}))

vi.mock('../lib/api.js', () => ({
  getJson: vi.fn(),
  pairEndpoint: vi.fn((path, drugAId, drugBId) => `${path}?drug_a_id=${drugAId}&drug_b_id=${drugBId}`),
}))

const IMPORTANT_EVIDENCE = {
  label_evidence: {
    evidence_found: true,
    pair_evidence: [{ section: 'drug_interactions' }, { section: 'warnings' }],
  },
  literature: { papers: [] },
}

const REVIEW_EVIDENCE = {
  label_evidence: { evidence_found: false, pair_evidence: [] },
  literature: { papers: [{ pmid: '1' }] },
}

const INSUFFICIENT_EVIDENCE = {
  label_evidence: { evidence_found: false, pair_evidence: [] },
  literature: { papers: [] },
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MyMedicines />
    </MemoryRouter>,
  )
}

async function addMedicine(user, name) {
  await user.selectOptions(screen.getByRole('combobox', { name: 'Search medicine' }), name)
  await user.click(screen.getByRole('button', { name: 'Add medicine' }))
}

describe('My Medicines', () => {
  beforeEach(() => {
    window.localStorage.clear()
    getJson.mockReset()
  })

  it('adds a medicine and stores only its canonical name and ID locally', async () => {
    const user = userEvent.setup()
    renderPage()

    await addMedicine(user, 'Warfarin')

    expect(screen.getByRole('link', { name: 'View in My Health' })).toHaveAttribute('href', '/my-health')
    const selected = screen.getByRole('list', { name: 'Selected medicines' })
    expect(within(selected).getByText('Warfarin')).toBeVisible()
    expect(within(selected).getByText('DB00682')).toBeVisible()
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('cheers.my-medicines.v1'))).toEqual([
        { entity_id: 'DB00682', name: 'Warfarin' },
      ])
    })
  })

  it('prevents duplicates, removes medicines, and clears the local list', async () => {
    const user = userEvent.setup()
    renderPage()

    await addMedicine(user, 'Warfarin')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search medicine' }), 'Warfarin')
    expect(screen.getByText('This medicine is already in your list.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add medicine' })).toBeDisabled()
    expect(screen.getByRole('list', { name: 'Selected medicines' }).children).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Remove Warfarin' }))
    expect(screen.getByText('No medicines added yet.')).toBeVisible()

    await addMedicine(user, 'Warfarin')
    await addMedicine(user, 'Ibuprofen')
    expect(screen.getByRole('list', { name: 'Selected medicines' }).children).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Clear my medicines' }))
    expect(screen.getByText('No medicines added yet.')).toBeVisible()
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('cheers.my-medicines.v1'))).toEqual([])
    })
  })

  it('generates every unique pair once in deterministic list order', () => {
    const medicines = [
      { entity_id: 'A', name: 'A' },
      { entity_id: 'B', name: 'B' },
      { entity_id: 'C', name: 'C' },
    ]

    expect(generateUniqueMedicinePairs(medicines)).toEqual([
      { drugA: medicines[0], drugB: medicines[1] },
      { drugA: medicines[0], drugB: medicines[2] },
      { drugA: medicines[1], drugB: medicines[2] },
    ])
  })

  it('checks three medicines as three unique pairs and renders all existing states', async () => {
    const user = userEvent.setup()
    getJson
      .mockResolvedValueOnce(IMPORTANT_EVIDENCE)
      .mockResolvedValueOnce(REVIEW_EVIDENCE)
      .mockResolvedValueOnce(INSUFFICIENT_EVIDENCE)
    renderPage()

    await addMedicine(user, 'Warfarin')
    await addMedicine(user, 'Ibuprofen')
    await addMedicine(user, 'Metformin')
    await user.click(screen.getByRole('button', { name: 'Check combinations' }))

    const summary = await screen.findByLabelText('Medicine review summary')
    expect(within(summary).getByText('medicines').closest('article')).toHaveTextContent('3')
    expect(within(summary).getByText('combinations checked').closest('article')).toHaveTextContent('3')
    expect(within(summary).getByText('interaction warning').closest('article')).toHaveTextContent('1')
    expect(within(summary).getByText('needs review').closest('article')).toHaveTextContent('1')
    expect(within(summary).getByText('not enough information').closest('article')).toHaveTextContent('1')
    expect(getJson).toHaveBeenCalledTimes(3)
    expect(getJson.mock.calls.map(([path]) => path)).toEqual([
      '/api/evidence/pair?drug_a_id=DB00682&drug_b_id=DB01050',
      '/api/evidence/pair?drug_a_id=DB00682&drug_b_id=DB00331',
      '/api/evidence/pair?drug_a_id=DB01050&drug_b_id=DB00331',
    ])

    expect(screen.getByText('Interaction warning found')).toBeVisible()
    expect(screen.getByText('Needs review')).toBeVisible()
    expect(screen.getByText('Not enough information')).toBeVisible()
    expect(screen.queryByText(/^Safe$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/overall safe|risk score|compatible|probability/i)).not.toBeInTheDocument()
  })

  it('keeps checking after an individual pair request fails', async () => {
    const user = userEvent.setup()
    getJson
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(REVIEW_EVIDENCE)
      .mockResolvedValueOnce(INSUFFICIENT_EVIDENCE)
    renderPage()

    await addMedicine(user, 'Warfarin')
    await addMedicine(user, 'Ibuprofen')
    await addMedicine(user, 'Metformin')
    await user.click(screen.getByRole('button', { name: 'Check combinations' }))

    expect(await screen.findByText(/Sources could not be retrieved for this combination/)).toBeVisible()
    const summary = await screen.findByLabelText('Medicine review summary')
    expect(within(summary).getByText('combinations checked').closest('article')).toHaveTextContent('3')
    expect(getJson).toHaveBeenCalledTimes(3)
  })

  it('checks all 28 pairs with at most four in flight and displays settled results in original order', async () => {
    const user = userEvent.setup()
    const medicines = Array.from({ length: 8 }, (_, index) => ({
      entity_id: `TEST${index}`, name: `Medicine ${index}`,
    }))
    window.localStorage.setItem('cheers.my-medicines.v1', JSON.stringify(medicines))
    const pending = []
    let active = 0
    let peak = 0
    getJson.mockImplementation((path) => {
      active += 1
      peak = Math.max(peak, active)
      const request = { path, settled: false }
      pending.push(request)
      return new Promise((resolve, reject) => {
        request.finish = (failed = false) => {
          request.settled = true
          if (failed) reject(new Error('unavailable'))
          else resolve(INSUFFICIENT_EVIDENCE)
        }
      }).finally(() => { active -= 1 })
    })
    const { container } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Check combinations' }))

    expect(pending).toHaveLength(4)
    expect(screen.getByText('Checked 0 of 28 combinations')).toBeVisible()
    expect(container.querySelectorAll('.my-medicines-pair-card')).toHaveLength(0)

    await act(async () => { pending[3].finish(true) })
    expect(pending).toHaveLength(5)
    expect(screen.getByText('Checked 1 of 28 combinations')).toBeVisible()
    expect(screen.getByText('Combination 4')).toBeVisible()
    expect(screen.getByText(/Sources could not be retrieved for this combination/)).toBeVisible()
    expect(screen.queryByLabelText('Medicine review summary')).not.toBeInTheDocument()

    await act(async () => { pending[0].finish() })
    expect(screen.getByText('Checked 2 of 28 combinations')).toBeVisible()
    let cards = [...container.querySelectorAll('.my-medicines-pair-card')]
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Combination 1')
    expect(cards[1]).toHaveTextContent('Combination 4')

    while (pending.some((request) => !request.settled)) {
      const next = pending.findLast((request) => !request.settled)
      await act(async () => { next.finish() })
      expect(active).toBeLessThanOrEqual(4)
    }

    const pairs = generateUniqueMedicinePairs(medicines)
    expect(pending.map(({ path }) => path)).toEqual(pairs.map(({ drugA, drugB }) => (
      `/api/evidence/pair?drug_a_id=${drugA.entity_id}&drug_b_id=${drugB.entity_id}`
    )))
    expect(new Set(pending.map(({ path }) => path)).size).toBe(28)
    expect(peak).toBe(4)
    expect(active).toBe(0)
    cards = [...container.querySelectorAll('.my-medicines-pair-card')]
    expect(cards).toHaveLength(28)
    cards.forEach((card, index) => {
      expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent(
        `${pairs[index].drugA.name} + ${pairs[index].drugB.name}`,
      )
      expect(card).toHaveTextContent(`Combination ${index + 1}`)
    })
    expect(screen.getByLabelText('Medicine review summary')).toHaveTextContent('28combinations checked')
    expect(screen.queryByText(/^Checked \d+ of 28 combinations$/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Medicine 0' }))
    expect(container.querySelectorAll('.my-medicines-pair-card')).toHaveLength(0)
    expect(screen.queryByLabelText('Medicine review summary')).not.toBeInTheDocument()
  })

  it('ignores stale completions and stops queued pairs after unmount', async () => {
    const user = userEvent.setup()
    const medicines = Array.from({ length: 4 }, (_, index) => ({
      entity_id: `TEST${index}`, name: `Medicine ${index}`,
    }))
    window.localStorage.setItem('cheers.my-medicines.v1', JSON.stringify(medicines))
    const settle = []
    getJson.mockImplementation(() => new Promise((resolve) => settle.push(resolve)))
    const { unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Check combinations' }))
    expect(getJson).toHaveBeenCalledTimes(4)
    unmount()

    window.localStorage.setItem('cheers.my-medicines.v1', JSON.stringify(medicines.slice(0, 2)))
    renderPage()
    await act(async () => { settle.forEach((resolve) => resolve(IMPORTANT_EVIDENCE)) })
    expect(getJson).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole('heading', { name: 'Your medicine review' })).not.toBeInTheDocument()
    expect(screen.queryByText('Interaction warning found')).not.toBeInTheDocument()
  })

  it('provides existing pair-review, checker, evidence, and graph routes', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue(IMPORTANT_EVIDENCE)
    renderPage()

    await addMedicine(user, 'Warfarin')
    await addMedicine(user, 'Acetylsalicylic acid')
    await user.click(screen.getByRole('button', { name: 'Check combinations' }))

    const actions = await screen.findByRole('navigation', {
      name: 'Actions for Warfarin and Acetylsalicylic acid',
    })
    expect(within(actions).getByRole('link', { name: 'Review pair' })).toHaveAttribute(
      'href',
      '/search?q=Warfarin%20with%20Acetylsalicylic%20acid',
    )
    expect(within(actions).getByRole('link', { name: 'Open Medicine Checker' })).toHaveAttribute(
      'href',
      '/check?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    expect(within(actions).getByRole('link', { name: 'Review sources' })).toHaveAttribute(
      'href',
      '/evidence?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    expect(within(actions).getByRole('link', { name: 'Explore biomedical connections' })).toHaveAttribute(
      'href',
      '/graph?drug_a_id=DB00682&drug_b_id=DB00945',
    )
  })
})
