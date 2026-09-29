import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GraphExplorer from './GraphExplorer.jsx'
import { getJson } from '../lib/api.js'

vi.mock('cytoscape', () => ({ default: vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() })) }))
vi.mock('../components/MedicineLabelScanner.jsx', () => ({ default: () => null }))
vi.mock('../lib/api.js', () => ({
  getJson: vi.fn(),
  pairEndpoint: vi.fn((path, drugAId, drugBId) => `${path}?drug_a_id=${drugAId}&drug_b_id=${drugBId}`),
  resolveDrug: vi.fn(),
}))

const TESTOSTERONE = { name: '(1,2,6,7-3H)Testosterone', entity_id: 'DB14093', node_id: 14093 }
const UNSUPPORTED = { name: 'Ethanolamine oleate', entity_id: 'DB00057', node_id: 57 }
const WARFARIN = { name: 'Warfarin', entity_id: 'DB00682', node_id: 682 }
const ASPIRIN = { name: 'Aspirin', entity_id: 'DB00945', node_id: 945 }
const IBUPROFEN = { name: 'Ibuprofen', entity_id: 'DB01050', node_id: 1050 }
const RESULTS = [TESTOSTERONE, UNSUPPORTED, WARFARIN, ASPIRIN, IBUPROFEN]

const SUGGESTIONS = [
  {
    anchor_drug_id: 'DB00682',
    anchor_drug_name: 'Warfarin',
    candidate_drug_id: 'DB00316',
    candidate_drug_name: 'Acetaminophen',
    shared: { total: 12, gene_protein_count: 7, disease_count: 5 },
  },
]

function drugContext(drug) {
  return {
    drug_id: drug.entity_id,
    drug_name: drug.name,
    drug_node_id: drug.node_id,
    total_context_edges: 0,
    context: {},
  }
}

function pairContext(drugA = WARFARIN, drugB = ASPIRIN, sharedTotal = 0) {
  const entities = Array.from({ length: sharedTotal }, (_, index) => ({
    context_node_id: 2000 + index,
    context_id: String(2000 + index),
    context_name: `Shared gene ${index + 1}`,
    context_group: 'gene/protein',
    context_source: 'NCBI',
    drug_a_relations: ['target'],
    drug_b_relations: ['enzyme'],
  }))
  return {
    drug_a: drugContext(drugA),
    drug_b: drugContext(drugB),
    shared: {
      total: sharedTotal,
      gene_protein_count: sharedTotal,
      disease_count: 0,
      entities,
    },
    interpretation: 'Fixture interpretation boundary.',
  }
}

function suggestionRequests() {
  return getJson.mock.calls.filter(
    ([path]) => path.startsWith('/api/context/pair-suggestions?'),
  )
}

function Destination() {
  const location = useLocation()
  return <p>Destination: {location.pathname}{location.search}</p>
}

function renderExplorer() {
  getJson.mockResolvedValue({ results: RESULTS, has_more: false })
  render(
    <MemoryRouter initialEntries={['/graph']}>
      <Routes>
        <Route path="/graph" element={<GraphExplorer />} />
        <Route path="/check" element={<Destination />} />
        <Route path="/evidence" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function selectDrug(input, drugName) {
  fireEvent.change(input, { target: { value: drugName } })
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(drugName, 'i') }))
}

describe('GraphExplorer context availability', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('marks DB14093 unavailable and disables an unsupported + supported pair', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')

    await selectDrug(drugAInput, 'Testosterone')
    await selectDrug(drugBInput, 'Warfarin')

    expect(screen.getByText('No research connections available')).toBeVisible()
    expect(screen.getByText('Research connections available')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Explore pair' })).toBeDisabled()
    expect(screen.getByText(/remains available in the DDI Predictor/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open DDI Predictor' })).toHaveAttribute('href', '/predictor')
    expect(suggestionRequests()).toHaveLength(0)
  })

  it('disables an unsupported + unsupported pair without treating it as an error', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')

    await selectDrug(drugAInput, 'Testosterone')
    await selectDrug(drugBInput, 'Ethanolamine')

    expect(screen.getAllByText('No research connections available')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Explore pair' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('enables a supported + supported pair and keeps the normal empty state', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')

    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')

    expect(screen.getAllByText('Research connections available')).toHaveLength(2)
    expect(screen.getAllByText('Scan a medicine label')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Explore pair' })).toBeEnabled()
    expect(screen.queryByText(/remains available in the DDI Predictor/)).not.toBeInTheDocument()
    expect(screen.getByText('Choose a drug pair.')).toBeVisible()
  })

  it('retains error treatment for a genuine context request failure', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')

    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    getJson.mockRejectedValueOnce(new Error('Context API unavailable.'))
    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))

    expect(await screen.findByText('Research connections could not be loaded. Please try again.')).toHaveClass('inline-alert', 'error')
    expect(screen.queryByText('Context API unavailable.')).not.toBeInTheDocument()
    expect(getJson).toHaveBeenLastCalledWith('/api/context/pair?drug_a_id=DB00682&drug_b_id=DB00945')
    expect(suggestionRequests()).toHaveLength(0)
  })

  it('requests and displays neutral alternatives only after a zero-shared result', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')
    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    getJson
      .mockResolvedValueOnce(pairContext())
      .mockResolvedValueOnce({
        pair: { drug_a_id: 'DB00682', drug_b_id: 'DB00945' },
        suggestions: SUGGESTIONS,
        count: 1,
        interpretation: 'Fixture graph-only interpretation.',
      })

    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))

    expect(await screen.findByText('No direct shared research connections were found for this pair.')).toBeVisible()
    expect(suggestionRequests()).toEqual([
      ['/api/context/pair-suggestions?drug_a_id=DB00682&drug_b_id=DB00945&limit=6'],
    ])
    const section = screen.getByRole('region', {
      name: 'Try another pair with shared research connections',
    })
    expect(within(section).getByRole('heading', { name: 'Warfarin + Acetaminophen' })).toBeVisible()
    expect(within(section).getByText('12')).toBeVisible()
    expect(within(section).getByText('7')).toBeVisible()
    expect(within(section).getByText('5')).toBeVisible()
    expect(within(section).getByRole('link', { name: 'Explore this pair' })).toHaveAttribute(
      'href',
      '/graph?drug_a_id=DB00682&drug_b_id=DB00316',
    )
    expect(section).toHaveTextContent(
      'This does not indicate interaction strength, safety, or clinical relevance.',
    )
    expect(section).not.toHaveTextContent(
      /recommended|better|safer|stronger interaction|higher risk|model score|probability|DDI prediction/i,
    )
  })

  it('does not request suggestions for a positive-shared result', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')
    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    getJson.mockResolvedValueOnce(pairContext(WARFARIN, ASPIRIN, 1))

    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))

    expect(await screen.findByRole('img', { name: /Interactive knowledge-graph relationships for Warfarin and Aspirin/ })).toBeVisible()
    expect(suggestionRequests()).toHaveLength(0)
    expect(screen.queryByText('Try another pair with shared research connections')).not.toBeInTheDocument()
  })

  it('summarizes the pair, makes display limits explicit, and explains graph interaction', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')
    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    getJson.mockResolvedValueOnce(pairContext(WARFARIN, ASPIRIN, 16))

    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))

    const summary = await screen.findByLabelText('Selected pair summary')
    expect(summary).toHaveTextContent('Warfarin + Aspirin')
    expect(summary).toHaveTextContent('Showing 15 of 16 shared context entities')
    expect(screen.getByText('Select a node to highlight its connections and view details. Select an edge to inspect its relation.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveAttribute('title', 'Zoom in')
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveAttribute('title', 'Zoom out')
    expect(screen.getByRole('button', { name: 'Fit graph to view' })).toHaveAttribute('title', 'Fit graph to view')
    expect(screen.getByText(/does not validate knowledge-graph relationships or an R-GCN prediction/i)).toBeVisible()
    expect(screen.getByText(/does not prove a DDI, causation, safety, or harm/i)).toBeVisible()
  })

  it('keeps the zero result when no alternative pair is returned', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')
    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    getJson
      .mockResolvedValueOnce(pairContext())
      .mockResolvedValueOnce({ suggestions: [], count: 0 })

    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))

    expect(await screen.findByText('No alternative pairs with shared context were found for these medicines.')).toBeVisible()
    expect(screen.getByText('No direct shared research connections were found for this pair.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the zero result when suggestion loading fails', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')
    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    getJson
      .mockResolvedValueOnce(pairContext())
      .mockRejectedValueOnce(new Error('Suggestion API unavailable.'))

    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))

    expect(await screen.findByText('Alternative pair suggestions could not be loaded.')).toBeVisible()
    expect(screen.getByText('No direct shared research connections were found for this pair.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not publish a stale suggestion response under a newer pair', async () => {
    let resolveSuggestions
    const pendingSuggestions = new Promise((resolve) => {
      resolveSuggestions = resolve
    })
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')
    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    getJson
      .mockResolvedValueOnce(pairContext())
      .mockReturnValueOnce(pendingSuggestions)
    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))
    expect(await screen.findByText('Loading alternative pairs...')).toBeVisible()

    await selectDrug(drugBInput, 'Ibuprofen')
    getJson.mockResolvedValueOnce(pairContext(WARFARIN, IBUPROFEN, 1))
    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))
    expect(await screen.findByRole('img', { name: /Interactive knowledge-graph relationships for Warfarin and Ibuprofen/ })).toBeVisible()

    await act(async () => {
      resolveSuggestions({ suggestions: SUGGESTIONS, count: 1 })
      await pendingSuggestions
    })

    await waitFor(() => {
      expect(screen.queryByText('Warfarin + Acetaminophen')).not.toBeInTheDocument()
    })
  })

  it.each([
    ['link', 'Check this medicine pair', '/check'],
    ['button', 'Review evidence', '/evidence'],
  ])('links a loaded pair to %s %s with both drug IDs', async (role, name, path) => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')
    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')
    expect(screen.queryByRole('link', { name: 'Check this medicine pair' })).not.toBeInTheDocument()
    getJson.mockResolvedValueOnce(pairContext(WARFARIN, ASPIRIN, 1))
    await userEvent.click(screen.getByRole('button', { name: 'Explore pair' }))
    const action = await screen.findByRole(role, { name })
    expect(screen.getByRole('link', { name: 'Check this medicine pair' })).toHaveAttribute(
      'href', '/check?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    await userEvent.click(action)
    expect(screen.getByText(`Destination: ${path}?drug_a_id=DB00682&drug_b_id=DB00945`)).toBeVisible()
  })

  it('labels autocomplete results with context availability only on this page', async () => {
    renderExplorer()
    const [drugAInput] = screen.getAllByRole('combobox')

    fireEvent.change(drugAInput, { target: { value: 'drug' } })

    expect(await screen.findAllByText('No research connections')).toHaveLength(2)
    expect(screen.getAllByText('Research connections')).toHaveLength(3)
  })
})
