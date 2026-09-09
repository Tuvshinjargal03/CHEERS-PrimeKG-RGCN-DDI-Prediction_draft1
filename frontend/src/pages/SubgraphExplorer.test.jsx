import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import SubgraphExplorer from './SubgraphExplorer.jsx'

vi.mock('cytoscape', () => ({
  default: vi.fn(() => ({
    $id: vi.fn(() => ({ connectedEdges: vi.fn(), edgesTo: vi.fn() })),
    destroy: vi.fn(),
    elements: vi.fn(),
    fit: vi.fn(),
    on: vi.fn(),
  })),
}))
vi.mock('../lib/api.js', () => ({
  drugContextEndpoint: ({ drugId }) => `/api/context/drug?drug_id=${drugId}`,
  getJson: vi.fn(),
}))
vi.mock('../components/DrugAutocomplete.jsx', () => ({
  default: ({ selection }) => <output data-testid="selected-drug">{selection?.name || ''}</output>,
}))
vi.mock('../components/MedicineLabelScanner.jsx', () => ({ default: () => null }))

const METFORMIN_CONTEXT = {
  center: { node_id: 331, entity_id: 'DB00331', name: 'Metformin', entity_type: 'drug' },
  neighbors: [],
  counts: {
    total_neighbors: 0,
    total_relationships: 0,
    by_relation: {
      drug_drug: 0, target: 0, enzyme: 0, transporter: 0,
      carrier: 0, indication: 0, contraindication: 0, 'off-label use': 0,
    },
    by_entity_type: { drug: 0, 'gene/protein': 0, disease: 0 },
  },
  pagination: { offset: 0, has_more: false, next_offset: null },
  filters: { relations: [], entity_types: [] },
  interpretation: 'Research context only.',
}

describe('SubgraphExplorer navigation', () => {
  beforeEach(() => {
    getJson.mockReset()
    getJson.mockResolvedValue(METFORMIN_CONTEXT)
  })

  it('loads a medicine passed through search parameters exactly once', async () => {
    render(
      <MemoryRouter initialEntries={['/subgraph?drug_id=DB00331&drug_name=Metformin']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('selected-drug')).toHaveTextContent('Metformin')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Visible relationships' })).toBeVisible())
    expect(getJson).toHaveBeenCalledTimes(1)
    expect(getJson).toHaveBeenCalledWith('/api/context/drug?drug_id=DB00331')
  })

  it('keeps a normal direct visit empty and makes no request', () => {
    render(
      <MemoryRouter initialEntries={['/subgraph']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('selected-drug')).toHaveTextContent('')
    expect(screen.getByText(/select one candidate drug/i)).toBeVisible()
    expect(getJson).not.toHaveBeenCalled()
  })
})
