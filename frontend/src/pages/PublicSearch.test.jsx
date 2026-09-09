import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import Home from './Home.jsx'
import PublicSearch from './PublicSearch.jsx'

vi.mock('../lib/api.js', () => ({ getJson: vi.fn() }))

const BASE = {
  original_query: '',
  normalized_query: '',
  recognized_entities: [],
  ambiguous_matches: [],
  available_modules: [],
  unavailable_modules: [],
  destinations: [],
  safety_note: 'Source-backed CHEERS information only.',
}
const WARFARIN = { entity_type: 'drug', entity_id: 'DB00682', name: 'Warfarin' }
const METFORMIN = { entity_type: 'drug', entity_id: 'DB00331', name: 'Metformin' }
const IBUPROFEN = { entity_type: 'drug', entity_id: 'DB01050', name: 'Ibuprofen' }
const DISEASE = { entity_type: 'disease', entity_id: '5148', name: 'type 2 diabetes mellitus' }
const INFLUENZA = { entity_type: 'disease', entity_id: '5812', name: 'influenza' }
const HYPERTENSION = {
  entity_type: 'disease',
  entity_id: '1200_1134_15512_5080_100078',
  name: 'hypertension',
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderSearch(entry = '/search?q=warfarin') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/search" element={<><PublicSearch /><LocationProbe /></>} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('public Home', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('presents the public hero, search, and four quick actions', () => {
    render(<MemoryRouter><Home /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /understand your medicines better/i })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: /search CHEERS/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /check medicines together/i })).toHaveAttribute('href', '/check')
    expect(screen.getByRole('link', { name: /medicine guide/i })).toHaveAttribute('href', '/medicines')
    expect(screen.getByRole('link', { name: /disease guide/i })).toHaveAttribute('href', '/diseases')
    expect(screen.getByRole('link', { name: /explore connections/i })).toHaveAttribute('href', '/graph')
  })

  it('submits the smart-search query without parsing it on Home', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Routes><Route path="/overview" element={<Home />} /><Route path="/search" element={<LocationProbe />} /></Routes>
      </MemoryRouter>,
    )
    await user.type(screen.getByRole('searchbox'), 'metformin side effects')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=metformin%20side%20effects')
  })

  it('routes safe example chips through the same search URL', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Routes><Route path="/overview" element={<Home />} /><Route path="/search" element={<LocationProbe />} /></Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'warfarin interactions' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=warfarin%20interactions')
  })
})

describe('deterministic public-search routing', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('presents Search as a question-answer tool with supported examples', () => {
    renderSearch('/search')
    expect(screen.getByRole('heading', { name: 'Ask CHEERS' })).toBeVisible()
    expect(screen.getByRole('searchbox')).toHaveAttribute(
      'placeholder',
      'Ask a question about medicines or diseases…',
    )
    expect(screen.getByRole('button', { name: 'Can I take warfarin with ibuprofen?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Metformin side effects' })).toBeVisible()
  })

  it('routes a disease result to its guide profile', async () => {
    getJson.mockResolvedValue({ ...BASE, intent: 'disease_information', recognized_entities: [DISEASE] })
    renderSearch('/search?q=what%20is%20type%202%20diabetes')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/diseases/5148'))
  })

  it('routes a single medicine to its profile', async () => {
    getJson.mockResolvedValue({ ...BASE, intent: 'drug_information', recognized_entities: [METFORMIN] })
    renderSearch('/search?q=metformin')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/medicines/DB00331'))
    expect(getJson).toHaveBeenCalledWith('/api/public/search?q=metformin')
  })

  it('routes side-effect and interaction intents to focused medicine sections', async () => {
    getJson.mockResolvedValue({ ...BASE, intent: 'drug_side_effects', recognized_entities: [METFORMIN] })
    renderSearch('/search?q=metformin%20side%20effects')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/medicines/DB00331?section=side-effects'))
  })

  it('routes a one-medicine interaction query to the interaction section', async () => {
    getJson.mockResolvedValue({ ...BASE, intent: 'drug_interactions', recognized_entities: [WARFARIN] })
    renderSearch('/search?q=warfarin%20interactions')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/medicines/DB00682?section=interactions'))
  })

  it('shows a food/lifestyle search result with a focused Medicine Guide action', async () => {
    getJson.mockImplementation((path) => {
      if (path.startsWith('/api/public/search')) {
        return Promise.resolve({
          ...BASE,
          intent: 'drug_food_lifestyle',
          recognized_entities: [METFORMIN],
          topic: 'alcohol',
          topic_label: 'Alcohol',
          focus: 'food_lifestyle',
        })
      }
      return Promise.resolve({
        label_information: {
          food_lifestyle_information: {
            status: 'available',
            topics: [{ topic: 'alcohol' }],
          },
        },
      })
    })
    renderSearch('/search?q=metformin%20alcohol')

    expect(await screen.findByText('CHEERS found food/lifestyle label information for this medicine.')).toBeVisible()
    expect(screen.getByText('Alcohol information')).toBeVisible()
    expect(screen.getByRole('link', { name: 'View Food & lifestyle information' })).toHaveAttribute(
      'href',
      '/medicines/DB00331?section=food-lifestyle',
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=metformin%20alcohol')
  })

  it('shows the narrow no-explicit-mention result for a food/lifestyle search', async () => {
    getJson.mockImplementation((path) => {
      if (path.startsWith('/api/public/search')) {
        return Promise.resolve({
          ...BASE,
          intent: 'drug_food_lifestyle',
          recognized_entities: [METFORMIN],
          topic: 'alcohol',
          topic_label: 'Alcohol',
        })
      }
      return Promise.resolve({
        label_information: {
          food_lifestyle_information: {
            status: 'no_explicit_mentions',
            topics: [],
          },
        },
      })
    })
    renderSearch('/search?q=metformin%20alcohol')

    expect(await screen.findByText('No explicit mention was retrieved in the checked label records.')).toBeVisible()
    expect(screen.getByText('This does not mean there is no interaction or concern.')).toBeVisible()
  })

  it('shows an available disease-nutrition route without duplicating guidance', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'disease_nutrition',
      recognized_entities: [DISEASE],
      available_modules: ['entity_identity', 'disease_nutrition_information'],
      answer: {
        disease: DISEASE,
        topic: 'Nutrition & lifestyle',
        availability: true,
        source_organization: 'National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)',
        destination: '/diseases/5148?section=nutrition-lifestyle',
        message: 'CHEERS has reviewed general nutrition information for this condition.',
      },
    })
    renderSearch('/search?q=type%202%20diabetes%20nutrition')

    expect(await screen.findByText('CHEERS has reviewed general nutrition information for this condition.')).toBeVisible()
    expect(screen.getByLabelText('Resolved disease and topic')).toHaveTextContent(
      'DiseaseType 2 diabetes mellitusTopicNutrition & lifestyle',
    )
    expect(screen.getByText(/National Institute of Diabetes and Digestive and Kidney Diseases/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'View Nutrition & lifestyle' })).toHaveAttribute(
      'href',
      '/diseases/5148?section=nutrition-lifestyle',
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=type%202%20diabetes%20nutrition')
    expect(screen.queryByText(/meal plan|calorie target|recommended diet/i)).not.toBeInTheDocument()
  })

  it('shows a neutral unavailable disease-nutrition route', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'disease_nutrition',
      recognized_entities: [HYPERTENSION],
      unavailable_modules: [{
        module: 'disease_nutrition_information',
        reason: 'Nutrition information is not currently available for this condition in CHEERS.',
      }],
      answer: {
        disease: HYPERTENSION,
        topic: 'Nutrition & lifestyle',
        availability: false,
        source_organization: null,
        destination: '/diseases/1200_1134_15512_5080_100078',
        message: 'Nutrition information is not currently available for this condition in CHEERS.',
      },
    })
    renderSearch('/search?q=influenza%20nutrition')

    expect(await screen.findByText('Nutrition information is not currently available for this condition in CHEERS.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'View disease information' })).toHaveAttribute(
      'href',
      '/diseases/1200_1134_15512_5080_100078',
    )
    expect(screen.queryByRole('link', { name: 'View Nutrition & lifestyle' })).not.toBeInTheDocument()
  })

  it('routes a recognized medicine pair to the public checker', async () => {
    getJson.mockResolvedValue({ ...BASE, intent: 'drug_pair', recognized_entities: [WARFARIN, IBUPROFEN] })
    renderSearch('/search?q=warfarin%20ibuprofen')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/check?drug_a_id=DB00682&drug_b_id=DB01050'))
  })

  it('shows a source-scoped indication answer before recognition details', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'drug_for_disease',
      recognized_entities: [METFORMIN, DISEASE],
      answer: {
        answer_type: 'indication_found',
        direct_answer: 'Yes — treatment indication found',
        drug: METFORMIN,
        disease: DISEASE,
        relationships: [{ relation: 'indication' }],
        source_scope: 'Checked CHEERS relationship data.',
        safety_note: 'This is not a personal prescription.',
      },
    })
    renderSearch('/search?q=is%20metformin%20used%20for%20type%202%20diabetes%20mellitus')

    expect(await screen.findByText('Yes')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Treatment indication found' })).toBeVisible()
    expect(screen.getByText(/Metformin has an indication relationship with Type 2 diabetes mellitus/)).toBeVisible()
    expect(screen.queryByText(/you should take/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Metformin' })).toHaveAttribute('href', '/medicines/DB00331')
  })

  it('shows the exact non-indication relationship without a plain yes or no', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'drug_for_disease',
      recognized_entities: [WARFARIN, DISEASE],
      answer: {
        answer_type: 'other_relationship_found',
        direct_answer: 'Not as a standard indication in the checked data',
        drug: WARFARIN,
        disease: DISEASE,
        relationships: [{ relation: 'contraindication' }],
        safety_note: 'Not a personalized recommendation.',
      },
    })
    renderSearch('/search?q=is%20warfarin%20used%20for%20type%202%20diabetes%20mellitus')

    expect(await screen.findByText('Related, but not a standard indication')).toBeVisible()
    expect(screen.getByText('Contraindication')).toBeVisible()
    expect(screen.queryByText(/^yes$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^no$/i)).not.toBeInTheDocument()
  })

  it('shows no indication found without an absolute medicine prohibition', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'drug_for_disease',
      recognized_entities: [WARFARIN, INFLUENZA],
      answer: {
        answer_type: 'no_indication_found',
        direct_answer: 'No treatment indication found in the checked data',
        drug: WARFARIN,
        disease: INFLUENZA,
        relationships: [],
        safety_note: 'Missing relationship data does not establish a universal clinical conclusion.',
      },
    })
    renderSearch('/search?q=can%20i%20use%20warfarin%20for%20influenza')

    expect(await screen.findByText('No indication found')).toBeVisible()
    expect(screen.getByText(/did not find a treatment-indication relationship/)).toBeVisible()
    expect(screen.queryByText(/cannot use warfarin/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/never take/i)).not.toBeInTheDocument()
  })

  it('shows the pair warning state, names, counts, and source actions', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'drug_pair_question',
      recognized_entities: [WARFARIN, IBUPROFEN],
      destinations: [
        { module: 'pair_external_evidence', frontend_path: '/evidence?drug_a_id=DB00682&drug_b_id=DB01050' },
        { module: 'pair_graph_context', frontend_path: '/graph?drug_a_id=DB00682&drug_b_id=DB01050' },
      ],
      answer: {
        answer_type: 'interaction_warning_found',
        direct_answer: 'Interaction warning found',
        supporting_text: 'Interaction-related information for these medicines was found in official drug-label sources.',
        drug_1: WARFARIN,
        drug_2: IBUPROFEN,
        evidence_summary: { label_mentions: 16, pubmed_records: 5 },
        source_scope: 'Checked openFDA and PubMed sources.',
        safety_note: 'This is source review, not medical advice.',
      },
    })
    renderSearch('/search?q=can%20i%20take%20warfarin%20with%20ibuprofen')

    const pairHeading = await screen.findByRole('heading', { name: 'Warfarin + Ibuprofen' })
    expect(screen.getByText('Interaction warning found')).toBeVisible()
    expect(pairHeading.closest('section')).toHaveClass('is-warning')
    expect(screen.getByLabelText('Retrieved source counts')).toHaveTextContent('FDA label mentions16')
    expect(screen.getByLabelText('Retrieved source counts')).toHaveTextContent('PubMed records5')
    expect(screen.getByRole('link', { name: /Open Medicine Checker/i })).toHaveAttribute(
      'href',
      '/check?drug_a_id=DB00682&drug_b_id=DB01050',
    )
    expect(screen.getByRole('link', { name: /Review medicine-pair sources/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /Explore shared biomedical connections/i })).toBeVisible()
  })

  it('shows an amber review state for literature-only pair information', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'drug_pair_question',
      recognized_entities: [WARFARIN, METFORMIN],
      answer: {
        answer_type: 'needs_review',
        direct_answer: 'Needs review',
        supporting_text: 'Related information was found, but the checked sources do not support a simple safety verdict.',
        drug_1: WARFARIN,
        drug_2: METFORMIN,
        evidence_summary: { label_mentions: 0, pubmed_records: 5 },
        safety_note: 'This is source review, not medical advice.',
      },
    })
    renderSearch('/search?q=can%20i%20take%20warfarin%20with%20metformin')

    const pairHeading = await screen.findByRole('heading', { name: 'Warfarin + Metformin' })
    expect(screen.getByText('Needs review')).toBeVisible()
    expect(pairHeading.closest('section')).toHaveClass('is-review')
  })

  it('shows a neutral insufficient state without a safe verdict', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'drug_pair_question',
      recognized_entities: [WARFARIN, METFORMIN],
      answer: {
        answer_type: 'insufficient_information',
        direct_answer: 'Not enough information',
        supporting_text: 'CHEERS did not retrieve enough information for an interaction status.',
        drug_1: WARFARIN,
        drug_2: METFORMIN,
        evidence_summary: { label_mentions: 0, pubmed_records: 0 },
        safety_note: 'Missing evidence does not establish safety.',
      },
    })
    renderSearch('/search?q=can%20i%20take%20warfarin%20with%20metformin')

    const pairHeading = await screen.findByRole('heading', { name: 'Warfarin + Metformin' })
    expect(screen.getByText('Not enough information')).toBeVisible()
    expect(pairHeading.closest('section')).toHaveClass('is-neutral')
    expect(screen.queryByText(/^safe$/i)).not.toBeInTheDocument()
  })

  it('routes medicines-for-disease to Disease Guide without a recommendation', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'medicines_for_disease',
      recognized_entities: [DISEASE],
      answer: {
        answer_type: 'indication_medicines_found',
        direct_answer: 'Indication medicines found',
        disease: DISEASE,
        total_count: 47,
        medicines: [
          { drug_id: 'DB00284', drug_name: 'Acarbose', relation: 'indication' },
          { drug_id: 'DB00414', drug_name: 'Acetohexamide', relation: 'indication' },
          { drug_id: 'DB09043', drug_name: 'Albiglutide', relation: 'indication' },
          { drug_id: 'DB06203', drug_name: 'Alogliptin', relation: 'indication' },
          { drug_id: 'DB12417', drug_name: 'Anagliptin', relation: 'indication' },
          { drug_id: 'DB04830', drug_name: 'Buformin', relation: 'indication' },
        ],
        source_scope: 'Checked indication relationships in the Disease Guide data.',
        safety_note: 'These are not personalized treatment recommendations.',
      },
    })
    renderSearch('/search?q=what%20medicines%20are%20used%20for%20type%202%20diabetes%20mellitus')

    expect(await screen.findByRole('heading', { name: 'Type 2 diabetes mellitus' })).toBeVisible()
    expect(screen.getByText('47').closest('.public-medicine-count')).toHaveTextContent(
      '47 indication medicines found',
    )
    expect(screen.getByText('CHEERS found these medicines with indication relationships for this condition in the checked data.')).toBeVisible()
    expect(screen.getByLabelText('Indication medicines').children).toHaveLength(6)
    expect(screen.getByRole('heading', { name: 'Acarbose' })).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'View medicine' })[0]).toHaveAttribute('href', '/medicines/DB00284')
    expect(screen.getAllByRole('link', { name: 'Side effects' })[0]).toHaveAttribute('href', '/medicines/DB00284?section=side-effects')
    expect(screen.getAllByRole('link', { name: 'Check interactions' })[0]).toHaveAttribute('href', '/check?drug_a_id=DB00284')
    expect(screen.getByRole('link', { name: /View all 47 medicines/i })).toHaveAttribute('href', '/diseases/5148')
    expect(screen.queryByText(/contraindication/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/off-label/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/best|top treatment|you should take/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/recommended for you/i)).not.toBeInTheDocument()
  })

  it('shows a bounded no-indication-medicines state', async () => {
    const disease = { entity_type: 'disease', entity_id: '10870', name: 'tibial muscular dystrophy' }
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'medicines_for_disease',
      recognized_entities: [disease],
      answer: {
        answer_type: 'no_indication_medicines_found',
        direct_answer: 'No indication medicines found',
        disease,
        total_count: 0,
        medicines: [],
        source_scope: 'Checked indication relationships in the Disease Guide data.',
        safety_note: 'Missing relationships do not establish a universal clinical conclusion.',
      },
    })
    renderSearch('/search?q=medicines%20for%20tibial%20muscular%20dystrophy')

    expect(await screen.findByText('No indication medicines found')).toBeVisible()
    expect(screen.queryByLabelText('Indication medicines')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Disease Guide' })).toHaveAttribute('href', '/diseases/10870')
  })

  it('shows a neutral state when indication data is unavailable', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'medicines_for_disease',
      recognized_entities: [DISEASE],
      answer: {
        answer_type: 'insufficient_data',
        direct_answer: 'Not enough information',
        disease: DISEASE,
        total_count: 0,
        medicines: [],
        safety_note: 'No clinical conclusion is established.',
      },
    })
    renderSearch('/search?q=medicines%20for%20type%202%20diabetes%20mellitus')

    const heading = await screen.findByRole('heading', { name: 'Type 2 diabetes mellitus' })
    expect(screen.getByText('Not enough information')).toBeVisible()
    expect(heading.closest('section')).toHaveClass('is-neutral')
  })

  it('keeps ambiguous results on the clarification page without silent selection', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue({
      ...BASE,
      normalized_query: 'what is diabetes',
      intent: 'disease_information',
      ambiguous_matches: [{
        query_fragment: 'diabetes',
        total_matches: 2,
        entity_types: ['disease'],
        candidates: [
          { entity_type: 'disease', entity_id: '5148', name: 'type 2 diabetes mellitus' },
          { entity_type: 'disease', entity_id: '5015', name: 'diabetes mellitus disease' },
        ],
      }],
      unavailable_modules: [{ module: 'query_resolution', reason: 'Choose one.' }],
    })
    renderSearch('/search?q=what%20is%20diabetes')
    expect(await screen.findByText('Which entity did you mean?')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /type 2 diabetes mellitus/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=what%20is%20type%202%20diabetes%20mellitus')
  })

  it('shows friendly unknown and unsupported states instead of redirecting', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'unknown',
      unavailable_modules: [{ module: 'query_resolution', reason: 'No match.' }],
    })
    renderSearch('/search?q=quantum%20umbrella')
    expect(await screen.findByText('We could not confidently recognize that search')).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=quantum%20umbrella')
  })

  it('shows a recognized unsupported request with its reason', async () => {
    getJson.mockResolvedValue({
      ...BASE,
      intent: 'unsupported',
      recognized_entities: [WARFARIN, IBUPROFEN],
      unavailable_modules: [{ module: 'query_resolution', reason: 'A side-effect query must identify one drug, not a pair.' }],
    })
    renderSearch('/search?q=warfarin%20ibuprofen%20side%20effects')
    expect(await screen.findByText('A side-effect query must identify one drug, not a pair.')).toBeVisible()
  })

  it('shows an invalid API response as an error', async () => {
    getJson.mockResolvedValue(null)
    renderSearch()
    expect(await screen.findByRole('alert')).toHaveTextContent('The public search service returned an invalid response.')
  })

  it('submits a revised query to the backend router', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue({ ...BASE, intent: 'unknown' })
    renderSearch('/search')
    await user.type(screen.getByRole('searchbox'), 'DB00682')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/search?q=DB00682'))
  })
})
