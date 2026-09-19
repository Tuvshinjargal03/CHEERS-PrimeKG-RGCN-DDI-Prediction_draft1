import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import MyConditions from './MyConditions.jsx'

vi.mock('../lib/api.js', () => ({ getJson: vi.fn() }))

const DIABETES = {
  entity_type: 'disease',
  entity_id: '5148',
  name: 'type 2 diabetes mellitus',
}
const GOUT = {
  entity_type: 'disease',
  entity_id: '5393',
  name: 'gout',
}
const INFLUENZA = {
  entity_type: 'disease',
  entity_id: '5812',
  name: 'influenza',
}

function searchPayload(condition) {
  return {
    intent: 'disease_information',
    recognized_entities: [condition],
    ambiguous_matches: [],
  }
}

function diseasePayload(
  condition,
  { nutrition = false, indications = 0, other = 0, description = true } = {},
) {
  return {
    disease: {
      ...condition,
      verified_description_available: description,
      description: description
        ? `Approved source-backed description for ${condition.name}.`
        : null,
    },
    medicine_relationships: {
      indications: Array.from({ length: indications }, (_, index) => ({
        drug_id: `DB${String(index).padStart(5, '0')}`,
        drug_name: `Medicine ${index}`,
        relation: 'indication',
      })),
      other: Array.from({ length: other }, (_, index) => ({
        drug_id: `OTHER${index}`,
        drug_name: `Other medicine ${index}`,
        relation: index % 2 === 0 ? 'contraindication' : 'off-label use',
      })),
    },
    nutrition_lifestyle: nutrition
      ? { status: 'available' }
      : { status: 'unavailable' },
  }
}

function installApiFixtures() {
  getJson.mockImplementation((path) => {
    if (path.startsWith('/api/public/search')) {
      const query = decodeURIComponent(path.split('q=')[1] || '').toLocaleLowerCase()
      if (query.includes('gout')) return Promise.resolve(searchPayload(GOUT))
      if (query.includes('influenza')) return Promise.resolve(searchPayload(INFLUENZA))
      return Promise.resolve(searchPayload(DIABETES))
    }
    if (path.includes('disease_id=5393')) {
      return Promise.resolve(diseasePayload(GOUT, { nutrition: true, indications: 21, other: 92 }))
    }
    if (path.includes('disease_id=5812')) {
      return Promise.resolve(diseasePayload(INFLUENZA, { description: false }))
    }
    return Promise.resolve(diseasePayload(DIABETES, { nutrition: true, indications: 47, other: 19 }))
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MyConditions />
    </MemoryRouter>,
  )
}

async function searchAndAdd(user, query) {
  const input = screen.getByRole('combobox', { name: 'Search condition' })
  await user.clear(input)
  await user.type(input, query)
  await user.click(await screen.findByRole('option'))
  await user.click(screen.getByRole('button', { name: 'Save condition' }))
}

function conditionCard(name) {
  return screen.getByRole('button', { name: `Remove ${name}` }).closest('article')
}

describe('My Conditions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    getJson.mockReset()
  })

  it('adds a resolved condition and stores only its canonical name and ID', async () => {
    const user = userEvent.setup()
    installApiFixtures()
    renderPage()

    await searchAndAdd(user, 'diab')

    expect(screen.getByRole('link', { name: 'View in My Health' })).toHaveAttribute('href', '/my-health')
    const card = conditionCard(DIABETES.name)
    expect(within(card).getByRole('heading', { level: 3, name: DIABETES.name })).toBeVisible()
    expect(within(card).getByText('5148').tagName).toBe('SMALL')
    expect(within(card).getByRole('link', { name: 'View condition' })).toHaveAttribute('href', '/diseases/5148')
    expect(getJson).toHaveBeenCalledWith('/api/public/search?q=diab')
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('cheers.my-conditions.v1'))).toEqual([
        { entity_id: '5148', name: 'type 2 diabetes mellitus' },
      ])
    })
  })

  it('prevents duplicates, removes a condition, and clears all conditions', async () => {
    const user = userEvent.setup()
    installApiFixtures()
    renderPage()

    await searchAndAdd(user, 'type 2 diabetes mellitus')
    const input = screen.getByRole('combobox', { name: 'Search condition' })
    await user.type(input, 'diab')
    expect(await screen.findByRole('option', { name: /Saved/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save condition' })).toBeDisabled()
    expect(document.querySelectorAll('.my-conditions-card')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: `Remove ${DIABETES.name}` }))
    expect(screen.getByText('Save a condition to organize its available CHEERS information.')).toBeVisible()

    await searchAndAdd(user, 'type 2 diabetes mellitus')
    await searchAndAdd(user, 'gout')
    expect(document.querySelectorAll('.my-conditions-card')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Clear my conditions' }))
    expect(screen.getByText('Save a condition to organize its available CHEERS information.')).toBeVisible()
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('cheers.my-conditions.v1'))).toEqual([])
    })
  })

  it('restores and sanitizes saved conditions from localStorage', async () => {
    window.localStorage.setItem('cheers.my-conditions.v1', JSON.stringify([
      { entity_id: '5148', name: 'type 2 diabetes mellitus', severity: 'not allowed' },
      { entity_id: '5148', name: 'duplicate' },
    ]))
    installApiFixtures()
    renderPage()

    expect(await screen.findByRole('button', { name: `Remove ${DIABETES.name}` })).toBeVisible()
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('cheers.my-conditions.v1'))).toEqual([
        { entity_id: '5148', name: 'type 2 diabetes mellitus' },
      ])
    })
  })

  it('shows nutrition only when the Disease Information API reports it available', async () => {
    window.localStorage.setItem('cheers.my-conditions.v1', JSON.stringify([DIABETES, INFLUENZA]))
    installApiFixtures()
    renderPage()

    const diabetesCard = conditionCard(DIABETES.name)
    const influenzaCard = conditionCard(INFLUENZA.name)
    expect(await within(diabetesCard).findByRole('link', { name: 'Nutrition & lifestyle' })).toHaveAttribute(
      'href',
      '/diseases/5148?section=nutrition-lifestyle',
    )
    await within(influenzaCard).findByText('An approved short description is not currently available in CHEERS.')
    expect(within(influenzaCard).queryByRole('link', { name: 'Nutrition & lifestyle' })).not.toBeInTheDocument()
  })

  it('renders indication and other-relationship counts from the Disease Guide response', async () => {
    window.localStorage.setItem('cheers.my-conditions.v1', JSON.stringify([DIABETES]))
    installApiFixtures()
    renderPage()

    const facts = await within(conditionCard(DIABETES.name)).findByLabelText(
      `Available information for ${DIABETES.name}`,
    )
    expect(facts).toHaveTextContent('47medicines linked through indication')
    expect(facts).toHaveTextContent('19other typed biomedical relationships')
    expect(within(conditionCard(DIABETES.name)).getByRole('link', {
      name: 'View linked medicines',
    })).toHaveAttribute('href', '/search?q=medicines%20for%20type%202%20diabetes%20mellitus')
    expect(within(conditionCard(DIABETES.name)).getByLabelText(
      `Other relationship types for ${DIABETES.name}`,
    )).toHaveTextContent(/contraindication.*10/i)
    expect(within(conditionCard(DIABETES.name)).getByLabelText(
      `Other relationship types for ${DIABETES.name}`,
    )).toHaveTextContent(/off-label use.*9/i)
    expect(within(conditionCard(DIABETES.name)).queryByRole('link', {
      name: 'Explore biomedical relationships',
    })).not.toBeInTheDocument()
  })

  it('isolates one failed condition request from the remaining cards', async () => {
    window.localStorage.setItem('cheers.my-conditions.v1', JSON.stringify([DIABETES, GOUT]))
    getJson.mockImplementation((path) => {
      if (path.includes('disease_id=5393')) return Promise.reject(new Error('source unavailable'))
      return Promise.resolve(diseasePayload(DIABETES, { indications: 47, other: 19 }))
    })
    renderPage()

    expect(await within(conditionCard(GOUT.name)).findByRole('alert')).toHaveTextContent('source unavailable')
    expect(await within(conditionCard(DIABETES.name)).findByText('47')).toBeVisible()
    expect(document.querySelectorAll('.my-conditions-card')).toHaveLength(2)
  })

  it('states local-only privacy boundaries without medical recommendations', () => {
    installApiFixtures()
    renderPage()

    expect(screen.getByText(
      'Your selected conditions are stored only in this browser. CHEERS does not use them to diagnose or prescribe treatment.',
    )).toBeVisible()
    expect(screen.getByText(/not a medical record, diagnosis, or treatment recommendation/i)).toBeVisible()
    expect(screen.queryByText(/recommended medicines|best treatment|you should take/i)).not.toBeInTheDocument()
  })

  it('shows neutral browse guidance on empty focus without requesting an unsupported empty query', async () => {
    const user = userEvent.setup()
    installApiFixtures()
    renderPage()

    await user.click(screen.getByRole('combobox', { name: 'Search condition' }))
    expect(screen.getByRole('listbox', { name: 'Condition suggestions' })).toHaveTextContent('Browse conditions')
    expect(getJson).not.toHaveBeenCalled()
  })

  it('supports keyboard suggestion selection and Escape closing', async () => {
    const user = userEvent.setup()
    installApiFixtures()
    renderPage()
    const input = screen.getByRole('combobox', { name: 'Search condition' })

    await user.type(input, 'diab')
    const option = await screen.findByRole('option', { name: /type 2 diabetes mellitus/ })
    await user.keyboard('{ArrowDown}')
    expect(option).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(input).toHaveValue(DIABETES.name)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear condition search' }))
    await user.type(input, 'diab')
    await screen.findByRole('option', { name: /type 2 diabetes mellitus/ })
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
