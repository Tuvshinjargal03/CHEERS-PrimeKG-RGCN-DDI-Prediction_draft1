import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import MedicineGuide from './MedicineGuide.jsx'

const METFORMIN = { name: 'Metformin', entity_id: 'DB00331', node_id: 331 }

vi.mock('../components/DrugAutocomplete.jsx', () => ({
  default: ({ onSelect }) => <button type="button" onClick={() => onSelect(METFORMIN)}>Choose Metformin</button>,
}))
vi.mock('../components/MedicineLabelScanner.jsx', () => ({ default: () => null }))
vi.mock('../lib/api.js', () => ({ getJson: vi.fn() }))

const LABEL_PAYLOAD = {
  drug: { drug_id: 'DB00331', drug_name: 'Metformin', source: 'DrugBank' },
  safety_note: 'Official source information only.',
  label_information: {
    status: 'ok',
    records_found: 1,
    records_examined: 1,
    available_sections: ['indications_and_usage', 'adverse_reactions', 'warnings', 'drug_interactions'],
    query_url: 'https://api.fda.gov/drug/label.json?search=metformin',
    food_lifestyle_information: {
      status: 'available',
      topics: [
        {
          topic: 'alcohol',
          section: 'warnings',
          product_name: 'Example Metformin',
          product_classification: 'single_ingredient',
          product_classification_label: 'Single-ingredient / direct medicine product',
          active_ingredients: ['METFORMIN HYDROCHLORIDE'],
          source_id: 'set-1',
          spl_set_id: 'set-1',
          excerpt: 'Alcohol information from the checked official label record.',
          source: 'openFDA Drug Label',
          source_url: 'https://api.fda.gov/drug/label.json',
        },
        {
          topic: 'food_or_meals',
          section: 'dosage_and_administration',
          product_name: 'Example Metformin',
          product_classification: 'single_ingredient',
          product_classification_label: 'Single-ingredient / direct medicine product',
          active_ingredients: ['METFORMIN HYDROCHLORIDE'],
          source_id: 'set-1',
          spl_set_id: 'set-1',
          excerpt: 'Meal information from the checked official label record.',
          source: 'openFDA Drug Label',
          source_url: 'https://api.fda.gov/drug/label.json',
        },
      ],
    },
    records: [{
      product_name: 'Example Metformin',
      product_classification: {
        category: 'single_ingredient',
        label: 'Single-ingredient / direct medicine product',
        active_ingredients: ['METFORMIN HYDROCHLORIDE'],
      },
      spl_set_id: 'set-1',
      application_number: 'ANDA123',
      effective_time: '20260101',
      product_metadata: {
        brand_name: ['Example Metformin'],
        manufacturer_name: ['Example Manufacturer'],
        substance_name: ['METFORMIN HYDROCHLORIDE'],
      },
      sections: {
        indications_and_usage: [{ text: 'Official use section.', truncated: false }],
        adverse_reactions: [{ text: 'Official adverse reactions section.', truncated: false }],
        warnings: [{ text: 'Official warning section.', truncated: false }],
        drug_interactions: [{ text: 'Official interaction section.', truncated: false }],
      },
    }],
  },
}

const CONTEXT = {
  context: {
    disease: {
      relationships: [{ context_node_id: 1, context_id: '5148', context_name: 'type 2 diabetes mellitus', relation: 'indication' }],
    },
  },
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderGuide(entry) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/medicines" element={<><MedicineGuide /><LocationProbe /></>} />
        <Route path="/medicines/:drugId" element={<><MedicineGuide /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MedicineGuide', () => {
  beforeEach(() => {
    getJson.mockReset()
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine') ? LABEL_PAYLOAD : CONTEXT))
  })

  it('routes a selected recognized medicine to its profile', async () => {
    const user = userEvent.setup()
    renderGuide('/medicines')
    await user.click(screen.getByRole('button', { name: 'Choose Metformin' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/medicines/DB00331')
  })

  it('shows the recognized medicine and a public-facing module overview', async () => {
    renderGuide('/medicines/DB00331')
    expect(await screen.findByRole('heading', { name: 'Metformin' })).toBeVisible()
    expect(screen.getByText('DB00331')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Uses: Available' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Food & lifestyle: Available' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Related diseases: Available' })).toBeVisible()
    expect(screen.getByText(/1 label record reviewed · 4 label sections available/)).toBeVisible()
  })

  it('passes the displayed medicine to the Subgraph Explorer', async () => {
    renderGuide('/medicines/DB00331')

    expect(await screen.findByRole('link', { name: /explore graph/i })).toHaveAttribute(
      'href',
      '/subgraph?drug_id=DB00331&drug_name=Metformin',
    )
  })

  it('renders the Food & lifestyle tab with grouped bounded source details', async () => {
    renderGuide('/medicines/DB00331?section=food-lifestyle')

    expect(await screen.findByRole('link', { name: 'Food & lifestyle' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Alcohol', level: 3 })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Food & meals', level: 3 })).toBeVisible()
    expect(screen.getByText('Alcohol information from the checked official label record.')).toBeVisible()
    expect(screen.getAllByText('Single-ingredient / direct medicine product')).toHaveLength(2)
    expect(screen.getByText('Warnings', { selector: '.medicine-label-section-meta strong' })).toBeVisible()
    expect(screen.getAllByText('Source ID set-1')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'View full label text' })).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /open.*openFDA/i })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/\b(?:safe|unsafe|recommended)\b/i)
  })

  it('switches between bounded previews and complete FDA section text', async () => {
    const user = userEvent.setup()
    const fullFoodText = 'Complete alcohol section text returned by openFDA without a character limit.'
    const fullWarningText = 'Complete warning section text returned by openFDA without a character limit.'
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine')
      ? {
          ...LABEL_PAYLOAD,
          label_information: {
            ...LABEL_PAYLOAD.label_information,
            food_lifestyle_information: {
              ...LABEL_PAYLOAD.label_information.food_lifestyle_information,
              topics: [{
                ...LABEL_PAYLOAD.label_information.food_lifestyle_information.topics[0],
                excerpt: 'Bounded alcohol preview',
                full_text: fullFoodText,
                excerpt_truncated: true,
              }],
            },
            records: [{
              ...LABEL_PAYLOAD.label_information.records[0],
              sections: {
                ...LABEL_PAYLOAD.label_information.records[0].sections,
                warnings: [{ text: 'Bounded warning preview', full_text: fullWarningText, truncated: true }],
              },
            }],
          },
        }
      : CONTEXT))

    renderGuide('/medicines/DB00331?section=food-lifestyle')
    let toggle = await screen.findByRole('button', { name: 'View full label text' })
    expect(screen.getByText(/Bounded alcohol preview/)).toBeVisible()
    expect(screen.queryByText(fullFoodText)).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByText(fullFoodText)).toBeVisible()
    expect(screen.queryByText(/Bounded alcohol preview/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByText(/Bounded alcohol preview/)).toBeVisible()

    await user.click(screen.getByRole('link', { name: 'Warnings' }))
    toggle = await screen.findByRole('button', { name: 'View full label text' })
    await user.click(toggle)
    expect(screen.getByText(fullWarningText)).toBeVisible()
    expect(screen.queryByText(/Bounded warning preview/)).not.toBeInTheDocument()
  })

  it('sends very long FDA sections to the official label instead of expanding inline', async () => {
    const longSection = `Complete regulatory section ${'word '.repeat(600)}`
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine')
      ? {
          ...LABEL_PAYLOAD,
          label_information: {
            ...LABEL_PAYLOAD.label_information,
            food_lifestyle_information: {
              ...LABEL_PAYLOAD.label_information.food_lifestyle_information,
              topics: [{
                ...LABEL_PAYLOAD.label_information.food_lifestyle_information.topics[0],
                excerpt: 'Short alcohol preview.',
                full_text: longSection,
                excerpt_truncated: true,
              }],
            },
          },
        }
      : CONTEXT))

    renderGuide('/medicines/DB00331?section=food-lifestyle')

    expect(await screen.findByText('Short alcohol preview.')).toBeVisible()
    expect(screen.getByText(/shortened in CHEERS for readability/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'View full label text' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open official FDA label/i })).toHaveAttribute(
      'href',
      'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=set-1',
    )
    expect(screen.queryByText(longSection)).not.toBeInTheDocument()
  })

  it('shows the narrow no-explicit-mentions state without a safety conclusion', async () => {
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine')
      ? {
          ...LABEL_PAYLOAD,
          label_information: {
            ...LABEL_PAYLOAD.label_information,
            food_lifestyle_information: {
              status: 'no_explicit_mentions',
              topics: [],
            },
          },
        }
      : CONTEXT))
    renderGuide('/medicines/DB00331?section=food-lifestyle')

    expect(await screen.findByText('No explicit food or lifestyle information was retrieved from the checked label records.')).toBeVisible()
    expect(screen.getByText('This does not mean there is no interaction or concern.')).toBeVisible()
  })

  it('shows a neutral unavailable Food & lifestyle state', async () => {
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine')
      ? {
          ...LABEL_PAYLOAD,
          label_information: {
            ...LABEL_PAYLOAD.label_information,
            status: 'error',
            food_lifestyle_information: {
              status: 'unavailable',
              topics: [],
            },
          },
        }
      : CONTEXT))
    renderGuide('/medicines/DB00331?section=food-lifestyle')

    expect(await screen.findByText('Food and lifestyle label information is unavailable.')).toBeVisible()
    expect(screen.getByText('The official label source could not be checked. No medical conclusion has been generated.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps combination-product food information visibly labeled', async () => {
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine')
      ? {
          ...LABEL_PAYLOAD,
          label_information: {
            ...LABEL_PAYLOAD.label_information,
            food_lifestyle_information: {
              status: 'available',
              topics: [{
                ...LABEL_PAYLOAD.label_information.food_lifestyle_information.topics[0],
                product_name: 'Example Combination',
                product_classification: 'combination',
                product_classification_label: 'Combination product containing Metformin',
                active_ingredients: ['METFORMIN HYDROCHLORIDE', 'SECOND INGREDIENT'],
              }],
            },
          },
        }
      : CONTEXT))
    renderGuide('/medicines/DB00331?section=food-lifestyle')

    expect(await screen.findByText('Combination product containing Metformin')).toBeVisible()
    expect(screen.getByText('Example Combination')).toBeVisible()
    expect(screen.getByText(/METFORMIN HYDROCHLORIDE, SECOND INGREDIENT/)).toBeVisible()
    expect(screen.getByText(/not attributed to the selected ingredient alone/i)).toBeVisible()
  })

  it('focuses side-effect and warning label sections without generating a conclusion', async () => {
    const user = userEvent.setup()
    renderGuide('/medicines/DB00331?section=side-effects')
    const sourceText = await screen.findByText('Official adverse reactions section.')
    expect(sourceText).toBeVisible()
    expect(sourceText).toHaveClass('is-clamped')
    expect(screen.getByRole('link', { name: 'Side effects' })).toHaveAttribute('aria-current', 'page')

    const expandButton = screen.getByRole('button', { name: 'View full label text' })
    await user.click(expandButton)
    expect(sourceText).not.toHaveClass('is-clamped')
    expect(expandButton).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('link', { name: 'Warnings' }))
    expect(await screen.findByText('Official warning section.')).toBeVisible()
  })

  it('shows related disease relationships and source metadata', async () => {
    const user = userEvent.setup()
    renderGuide('/medicines/DB00331?section=related-diseases')
    expect(await screen.findByText('type 2 diabetes mellitus')).toBeVisible()
    expect(screen.getByText('indication')).toBeVisible()

    await user.click(screen.getByRole('link', { name: 'Sources' }))
    expect(await screen.findByText('Example Metformin')).toBeVisible()
    expect(screen.getByText('set-1')).toBeVisible()
  })

  it('labels combination and uncertain products without treating either as single-ingredient', async () => {
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine')
      ? {
          ...LABEL_PAYLOAD,
          label_information: {
            ...LABEL_PAYLOAD.label_information,
            records_examined: 2,
            records: [
              {
                ...LABEL_PAYLOAD.label_information.records[0],
                product_name: 'ZITUVIMET',
                product_classification: {
                  category: 'combination',
                  label: 'Combination product containing Metformin',
                  active_ingredients: ['SITAGLIPTIN PHOSPHATE', 'METFORMIN HYDROCHLORIDE'],
                },
              },
              {
                ...LABEL_PAYLOAD.label_information.records[0],
                spl_set_id: 'set-2',
                product_name: 'Uncertain product',
                product_classification: {
                  category: 'unknown',
                  label: 'Product type not confirmed',
                  active_ingredients: [],
                },
              },
            ],
          },
        }
      : CONTEXT))
    renderGuide('/medicines/DB00331?section=sources')

    expect(await screen.findByRole('heading', { name: 'Combination products containing this medicine' })).toBeVisible()
    expect(screen.getByText('Combination product containing Metformin')).toBeVisible()
    expect(screen.getByText('Product type not confirmed')).toBeVisible()
    expect(screen.queryByText('Single-ingredient products')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /view official FDA label/i })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /view official FDA label/i })[0]).toHaveAttribute(
      'href',
      'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=set-1',
    )
    expect(document.body).not.toHaveTextContent(/source query/i)
  })

  it('distinguishes an empty label source from an API failure', async () => {
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/public/medicine')
      ? {
          drug: { drug_id: 'DB00331', drug_name: 'Metformin' },
          label_information: { status: 'no_matches', records: [], available_sections: [] },
        }
      : CONTEXT))
    renderGuide('/medicines/DB00331?section=side-effects')
    expect(await screen.findByText('No openFDA label record was retrieved.')).toBeVisible()
  })

  it('shows a genuine medicine API failure', async () => {
    getJson.mockImplementation((path) => (
      path.startsWith('/api/public/medicine')
        ? Promise.reject(new Error('Medicine source unavailable.'))
        : Promise.resolve(CONTEXT)
    ))
    renderGuide('/medicines/DB00331')
    expect(await screen.findByRole('alert')).toHaveTextContent('Medicine source unavailable.')
  })
})
