import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import DiseaseGuide from './DiseaseGuide.jsx'

vi.mock('../lib/api.js', () => ({ getJson: vi.fn() }))

const APPROVED = {
  disease: {
    entity_id: '5148',
    name: 'type 2 diabetes mellitus',
    verified_description_available: true,
    description_status: 'approved',
    description: 'An approved simple disease description.',
    description_provenance: { source: 'MONDO', source_id: 'MONDO:0005148', license: 'CC BY 4.0' },
  },
  medicine_relationships: {
    total: 2,
    indications: [{
      drug_id: 'DB00331',
      drug_name: 'Metformin',
      relation: 'indication',
      context_source: 'MONDO',
    }],
    other: [{
      drug_id: 'DB00682',
      drug_name: 'Warfarin',
      relation: 'contraindication',
      context_source: 'MONDO',
    }],
  },
  relationship_scope: 'Indication relationships are not personalized prescriptions.',
}

const NUTRITION = {
  status: 'available',
  general_guidance: [{
    text: 'General source-backed nutrition context.',
    source_section: 'General guidance section',
  }],
  foods_emphasized: [{
    text: 'Source-backed food groups emphasized.',
    source_section: 'Foods emphasized section',
  }],
  foods_limited: [{
    text: 'Source-backed foods or nutrients limited.',
    source_section: 'Foods limited section',
  }],
  relevant_nutrients: [{
    text: 'Source-backed nutrient context.',
    source_section: 'Relevant nutrients section',
  }],
  source: {
    organization: 'National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)',
    page_title: 'Healthy Living with Diabetes',
    url: 'https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes',
    source_date: { label: 'Last Reviewed', value: 'October 2023' },
  },
  not_personalized: true,
}

function withNutrition(entityId, name, sourceOrganization) {
  return {
    ...APPROVED,
    disease: { ...APPROVED.disease, entity_id: entityId, name },
    nutrition_lifestyle: {
      ...NUTRITION,
      source: { ...NUTRITION.source, organization: sourceOrganization },
    },
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderGuide(entry) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/diseases" element={<><DiseaseGuide /><LocationProbe /></>} />
        <Route path="/diseases/:diseaseId" element={<><DiseaseGuide /><LocationProbe /></>} />
        <Route path="/search" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DiseaseGuide', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('routes a disease search through the deterministic public-search contract', async () => {
    const user = userEvent.setup()
    renderGuide('/diseases')
    await user.type(screen.getByRole('searchbox', { name: /search for a disease/i }), 'type 2 diabetes')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=type%202%20diabetes')
  })

  it('shows only the approved description with provenance', async () => {
    getJson.mockResolvedValue(APPROVED)
    renderGuide('/diseases/5148')
    expect(await screen.findByRole('heading', { name: 'Type 2 diabetes mellitus' })).toBeVisible()
    expect(await screen.findByText('An approved simple disease description.')).toBeVisible()
    expect(screen.getByText(/Source: MONDO · MONDO:0005148 · CC BY 4.0/)).toBeVisible()
  })

  it('shows a neutral unavailable state for an unapproved description', async () => {
    getJson.mockResolvedValue({
      ...APPROVED,
      disease: {
        entity_id: '5015',
        name: 'diabetes mellitus disease',
        verified_description_available: false,
        description_status: 'needs_review',
      },
    })
    renderGuide('/diseases/5015')
    expect(await screen.findByText('Verified explanation unavailable.')).toBeVisible()
    expect(screen.queryByText('An approved simple disease description.')).not.toBeInTheDocument()
  })

  it('separates indications from contraindication and other relationships', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue(APPROVED)
    renderGuide('/diseases/5148')

    const indicationSection = await screen.findByRole('heading', { name: 'Medicines associated through indication' })
    const indicationContainer = indicationSection.closest('section')
    expect(within(indicationContainer).getByText('Metformin')).toBeVisible()
    expect(within(indicationContainer).queryByText('Warfarin')).not.toBeInTheDocument()

    await user.click(screen.getByText('Other biomedical relationships').closest('summary'))
    const otherSection = screen.getByRole('heading', { name: 'Other biomedical relationships' }).closest('details')
    expect(within(otherSection).getByText('Warfarin')).toBeVisible()
    expect(within(otherSection).getByText('Contraindication')).toBeVisible()
  })

  it('shows a deterministic subset before allowing all indication medicines', async () => {
    const user = userEvent.setup()
    const indications = Array.from({ length: 12 }, (_, index) => ({
      drug_id: `DB${String(index + 1).padStart(5, '0')}`,
      drug_name: `Medicine ${String(index + 1).padStart(2, '0')}`,
      relation: 'indication',
      context_source: 'MONDO',
    }))
    getJson.mockResolvedValue({
      ...APPROVED,
      medicine_relationships: { ...APPROVED.medicine_relationships, indications },
    })
    renderGuide('/diseases/5148')

    expect(await screen.findByText('Medicine 10')).toBeVisible()
    expect(screen.queryByText('Medicine 11')).not.toBeInTheDocument()
    const showAll = screen.getByRole('button', { name: 'Show all 12' })
    await user.click(showAll)
    expect(screen.getByText('Medicine 12')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('Medicine 11')).not.toBeInTheDocument()
  })

  it('links medicine cards into profiles, side effects, and pair checking', async () => {
    getJson.mockResolvedValue(APPROVED)
    renderGuide('/diseases/5148')
    await screen.findByText('Metformin')
    expect(screen.getAllByRole('link', { name: 'View medicine' })[0]).toHaveAttribute('href', '/medicines/DB00331')
    expect(screen.getAllByRole('link', { name: 'Side effects' })[0]).toHaveAttribute('href', '/medicines/DB00331?section=side-effects')
    expect(screen.getAllByRole('link', { name: 'Check interactions' })[0]).toHaveAttribute('href', '/check?drug_a_id=DB00331')
  })

  it('contains no personalized recommendation or suitability language', async () => {
    getJson.mockResolvedValue(APPROVED)
    renderGuide('/diseases/5148')
    await screen.findByText('Metformin')
    expect(screen.queryByText(/% suitable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/match for you/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/recommended for you/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/best medicine/i)).not.toBeInTheDocument()
  })

  it.each([
    ['5148', 'type 2 diabetes mellitus', 'National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)'],
    ['5393', 'gout', 'National Institute of Arthritis and Musculoskeletal and Skin Diseases (NIAMS)'],
    ['1356', 'iron deficiency anemia', 'National Heart, Lung, and Blood Institute (NHLBI)'],
  ])('shows the Nutrition & lifestyle tab for reviewed disease %s', async (entityId, name, organization) => {
    getJson.mockResolvedValue(withNutrition(entityId, name, organization))
    renderGuide(`/diseases/${entityId}`)

    const nutritionTab = await screen.findByRole('link', { name: 'Nutrition & lifestyle' })
    expect(nutritionTab).toBeVisible()
    expect(nutritionTab).toHaveAttribute(
      'href',
      `/diseases/${entityId}?section=nutrition-lifestyle`,
    )
  })

  it('renders only returned nutrition categories with traceability and attribution', async () => {
    getJson.mockResolvedValue(withNutrition(
      '5148',
      'type 2 diabetes mellitus',
      'National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)',
    ))
    renderGuide('/diseases/5148?section=nutrition-lifestyle')

    expect(await screen.findByRole('heading', { name: 'Nutrition & lifestyle' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'General guidance' })).toBeVisible()
    expect(screen.getByText('General source-backed nutrition context.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Foods / food groups emphasized' })).toBeVisible()
    expect(screen.getByText('Source-backed food groups emphasized.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Foods / nutrients limited' })).toBeVisible()
    expect(screen.getByText('Source-backed foods or nutrients limited.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Relevant nutrients' })).toBeVisible()
    expect(screen.getByText('Source-backed nutrient context.')).toBeVisible()
    expect(screen.getByText('Source section: General guidance section')).toBeVisible()

    expect(screen.getByText(NUTRITION.source.organization)).toBeVisible()
    expect(screen.getByText(NUTRITION.source.page_title)).toBeVisible()
    expect(screen.getByText('Last Reviewed: October 2023')).toBeVisible()
    expect(screen.getByRole('link', { name: /view official source/i })).toHaveAttribute(
      'href',
      NUTRITION.source.url,
    )
    expect(screen.getByText(
      'General nutrition education for this condition. Not a personalized meal plan or medical nutrition therapy.',
    )).toBeVisible()
  })

  it('omits empty returned categories instead of inventing content', async () => {
    getJson.mockResolvedValue({
      ...withNutrition('1356', 'iron deficiency anemia', 'National Heart, Lung, and Blood Institute (NHLBI)'),
      nutrition_lifestyle: { ...NUTRITION, foods_limited: [] },
    })
    renderGuide('/diseases/1356?section=nutrition-lifestyle')

    expect(await screen.findByRole('heading', { name: 'Nutrition & lifestyle' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Foods / nutrients limited' })).not.toBeInTheDocument()
  })

  it('does not expose nutrition content for an unsupported disease', async () => {
    getJson.mockResolvedValue({
      ...APPROVED,
      disease: { ...APPROVED.disease, entity_id: '5015', name: 'diabetes mellitus disease' },
      nutrition_lifestyle: { status: 'unavailable' },
    })
    renderGuide('/diseases/5015?section=nutrition-lifestyle')

    expect(await screen.findByRole('heading', { name: 'Medicines associated through indication' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Nutrition & lifestyle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nutrition & lifestyle' })).not.toBeInTheDocument()
    expect(screen.queryByText('General source-backed nutrition context.')).not.toBeInTheDocument()
  })

  it('does not generate personalized recommendations or numeric diet targets', async () => {
    getJson.mockResolvedValue(withNutrition(
      '5393',
      'gout',
      'National Institute of Arthritis and Musculoskeletal and Skin Diseases (NIAMS)',
    ))
    renderGuide('/diseases/5393?section=nutrition-lifestyle')
    await screen.findByRole('heading', { name: 'Nutrition & lifestyle' })

    expect(screen.queryByText(/recommended for you/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/best diet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/you should eat/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/calorie target/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/macronutrient target/i)).not.toBeInTheDocument()
  })
})
