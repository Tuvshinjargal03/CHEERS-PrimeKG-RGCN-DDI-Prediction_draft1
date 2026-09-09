import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
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
    expect(screen.queryByText(/no relationship with/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/recommended for you|should take|suitable|best medicine/i)).not.toBeInTheDocument()
  })

  it('reviews combinations only on request and orders the existing statuses deterministically', async () => {
    const user = userEvent.setup()
    save('cheers.my-medicines.v1', [WARFARIN, METFORMIN, IBUPROFEN])
    installDefaultApi()
    renderPage()

    await waitFor(() => expect(getJson.mock.calls.filter(([path]) => path.startsWith('/api/public/medicine'))).toHaveLength(3))
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
    expect(screen.queryByText(/health score|risk score|safe profile|unsafe profile/i)).not.toBeInTheDocument()
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
