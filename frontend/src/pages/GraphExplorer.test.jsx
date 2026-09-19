import { fireEvent, render, screen } from '@testing-library/react'
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
const RESULTS = [TESTOSTERONE, UNSUPPORTED, WARFARIN, ASPIRIN]

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

    expect(screen.getByText('No verified G3 context')).toBeVisible()
    expect(screen.getByText('G3 context available')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Explore pair' })).toBeDisabled()
    expect(screen.getByText(/remains available in the DDI Predictor/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open DDI Predictor' })).toHaveAttribute('href', '/predictor')
  })

  it('disables an unsupported + unsupported pair without treating it as an error', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')

    await selectDrug(drugAInput, 'Testosterone')
    await selectDrug(drugBInput, 'Ethanolamine')

    expect(screen.getAllByText('No verified G3 context')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Explore pair' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('enables a supported + supported pair and keeps the normal empty state', async () => {
    renderExplorer()
    const [drugAInput, drugBInput] = screen.getAllByRole('combobox')

    await selectDrug(drugAInput, 'Warfarin')
    await selectDrug(drugBInput, 'Aspirin')

    expect(screen.getAllByText('G3 context available')).toHaveLength(2)
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

    expect(await screen.findByText('Context API unavailable.')).toHaveClass('inline-alert', 'error')
    expect(getJson).toHaveBeenLastCalledWith('/api/context/pair?drug_a_id=DB00682&drug_b_id=DB00945')
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
    const drugContext = (drug) => ({
      drug_id: drug.entity_id, drug_name: drug.name, drug_node_id: drug.node_id,
      total_context_edges: 0, context: {},
    })
    getJson.mockResolvedValueOnce({
      drug_a: drugContext(WARFARIN), drug_b: drugContext(ASPIRIN),
      shared: { total: 0, gene_protein_count: 0, disease_count: 0, entities: [] },
      interpretation: 'Fixture interpretation boundary.',
    })
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

    expect(await screen.findAllByText('No G3 context')).toHaveLength(2)
    expect(screen.getAllByText('G3 context')).toHaveLength(2)
  })
})
