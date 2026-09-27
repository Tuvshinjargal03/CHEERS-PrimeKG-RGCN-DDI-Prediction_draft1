import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drugContextEndpoint, getJson } from '../lib/api.js'
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
  drugContextEndpoint: vi.fn(({ drugId }) => `/api/context/drug?drug_id=${drugId}`),
  getJson: vi.fn(),
}))
vi.mock('../components/DrugAutocomplete.jsx', () => ({
  default: ({ selection }) => <output data-testid="selected-drug" data-entity-id={selection?.entity_id || ''}>{selection?.name || ''}</output>,
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

function pagedContext(offset = 0, returned = 50, hasMore = true) {
  const neighbors = Array.from({ length: returned }, (_, index) => ({
    node_id: 1000 + offset + index,
    entity_id: `GENE${1000 + offset + index}`,
    name: `Gene ${offset + index + 1}`,
    entity_type: 'gene/protein',
    source: 'NCBI',
    relationships: [{ relation: 'target', display_relation: 'Target' }],
  }))
  return {
    ...METFORMIN_CONTEXT,
    neighbors,
    counts: {
      total_neighbors: 143,
      total_relationships: 143,
      by_relation: { ...METFORMIN_CONTEXT.counts.by_relation, target: 143 },
      by_entity_type: { drug: 0, 'gene/protein': 143, disease: 0 },
    },
    pagination: {
      offset,
      limit: 50,
      returned_neighbors: returned,
      returned_relationships: returned,
      has_more: hasMore,
      next_offset: hasMore ? offset + 50 : null,
    },
  }
}

describe('SubgraphExplorer navigation', () => {
  beforeEach(() => {
    getJson.mockReset()
    drugContextEndpoint.mockClear()
    getJson.mockResolvedValue(METFORMIN_CONTEXT)
  })

  it('uses the returned canonical name for an ID-only URL while retaining the entity ID', async () => {
    let resolveRequest
    getJson.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    render(
      <MemoryRouter initialEntries={['/subgraph?drug_id=DB00331']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )

    const selection = screen.getByTestId('selected-drug')
    expect(selection).not.toHaveTextContent('DB00331')
    expect(selection).toHaveAttribute('data-entity-id', 'DB00331')
    expect(screen.getByRole('button', { name: /Fetching graph context/ })).toBeVisible()
    expect(getJson).toHaveBeenCalledWith('/api/context/drug?drug_id=DB00331')

    await act(async () => { resolveRequest(METFORMIN_CONTEXT) })
    expect(selection).toHaveTextContent('Metformin')
    expect(selection).toHaveAttribute('data-entity-id', 'DB00331')
  })

  it('loads a medicine passed through search parameters exactly once', async () => {
    render(
      <MemoryRouter initialEntries={['/subgraph?drug_id=DB00331&drug_name=Metformin']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('selected-drug')).toHaveTextContent('Metformin')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Visible neighborhood' })).toBeVisible())
    expect(getJson).toHaveBeenCalledTimes(1)
    expect(getJson).toHaveBeenCalledWith('/api/context/drug?drug_id=DB00331')
  })

  it('does not present the raw ID as a medicine name when canonical-name loading fails', async () => {
    getJson.mockRejectedValue(new Error('context unavailable'))
    render(
      <MemoryRouter initialEntries={['/subgraph?drug_id=DB00331']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )

    expect(await screen.findByText('context unavailable')).toBeVisible()
    const selection = screen.getByTestId('selected-drug')
    expect(selection).not.toHaveTextContent('DB00331')
    expect(selection).toHaveAttribute('data-entity-id', 'DB00331')
  })

  it('keeps a normal direct visit empty and makes no request', () => {
    render(
      <MemoryRouter initialEntries={['/subgraph']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('selected-drug')).toHaveTextContent('')
    expect(screen.getByText(/select one medicine to view its one-hop/i)).toBeVisible()
    expect(getJson).not.toHaveBeenCalled()
  })

  it('distinguishes the matching neighborhood from the current graph page', async () => {
    getJson
      .mockResolvedValueOnce(pagedContext())
      .mockResolvedValueOnce(pagedContext(50))
    render(
      <MemoryRouter initialEntries={['/subgraph?drug_id=DB00331&drug_name=Metformin']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )

    const summary = (await screen.findByText('Filtered G3 neighborhood')).parentElement
    expect(summary).toHaveTextContent('Showing 1–50 of 143 matching neighbors')
    expect(screen.getByText('Matching neighbors')).toBeVisible()
    expect(screen.getByText('Currently displayed')).toBeVisible()
    expect(screen.getByText('Current graph page: 1 of 3')).toBeVisible()
    expect(screen.getByText('Select a node or connection to focus it and view details.')).toBeVisible()
    expect(screen.getByText('Center drug')).toBeVisible()
    expect(screen.getAllByText(/Gene \/ protein/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Fit graph to view' })).toHaveAttribute('title', 'Fit graph to view')
    expect(screen.getByText(/Graph associations do not prove causation, a drug interaction, safety, or harm/i)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Next 50' }))
    await waitFor(() => expect(summary).toHaveTextContent('Showing 51–100 of 143 matching neighbors'))
    expect(screen.getByText('Current graph page: 2 of 3')).toBeVisible()
  })

  it('uses backend filters and treats an empty filter selection as a valid local result', async () => {
    getJson.mockResolvedValue(pagedContext())
    render(
      <MemoryRouter initialEntries={['/subgraph?drug_id=DB00331&drug_name=Metformin']}>
        <SubgraphExplorer />
      </MemoryRouter>,
    )
    await screen.findByText('Visible neighborhood')

    await userEvent.click(screen.getByRole('checkbox', { name: /Target/ }))
    expect(drugContextEndpoint).toHaveBeenLastCalledWith(expect.objectContaining({
      drugId: 'DB00331',
      offset: 0,
      relations: expect.not.arrayContaining(['target']),
    }))

    for (const label of ['DDI', 'Enzyme', 'Carrier', 'Transporter', 'Indication', 'Contraindication', 'Off-label use']) {
      await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^${label}`) }))
    }

    expect(screen.getByText('No neighbors match the current filters.')).toBeVisible()
    expect(screen.getByText(/not proof that no biomedical relationship or DDI exists/i)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
