import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import Evidence from './Evidence.jsx'

const WARFARIN = { name: 'Warfarin', entity_id: 'DB00682', node_id: 682 }
const ASPIRIN = { name: 'Aspirin', entity_id: 'DB00945', node_id: 945 }

vi.mock('../components/DrugAutocomplete.jsx', () => ({
  default: ({ label, selection, onSelect }) => (
    <button type="button" onClick={() => onSelect(label === 'Drug A' ? WARFARIN : ASPIRIN)}>
      {selection ? selection.name : `Choose ${label}`}
    </button>
  ),
}))
vi.mock('../components/MedicineLabelScanner.jsx', () => ({ default: () => null }))
vi.mock('../lib/api.js', () => ({
  getJson: vi.fn(),
  pairEndpoint: vi.fn((path, drugAId, drugBId) => `${path}?drug_a_id=${drugAId}&drug_b_id=${drugBId}`),
  resolveDrug: vi.fn(),
}))

const BASE_RESPONSE = {
  label_evidence: {
    drug_a: {
      drug_name: 'Warfarin',
      status: 'ok',
      records_found: 4,
      records_examined: 2,
      query_url: 'https://api.fda.gov/drug/label.json?search=warfarin',
    },
    drug_b: {
      drug_name: 'Aspirin',
      status: 'ok',
      records_found: 5,
      records_examined: 3,
      query_url: 'https://api.fda.gov/drug/label.json?search=aspirin',
    },
    pair_evidence: [
      {
        source_drug: 'Warfarin',
        mentioned_drug: 'Aspirin',
        section: 'warnings',
        snippet: 'First retrieved label excerpt.',
        spl_set_id: 'SPL-1',
        effective_time: '20250101',
      },
      {
        source_drug: 'Aspirin',
        mentioned_drug: 'Warfarin',
        section: 'drug_interactions',
        snippet: 'Second retrieved label excerpt.',
        spl_set_id: 'SPL-2',
        effective_time: '20250202',
      },
      {
        source_drug: 'Aspirin',
        mentioned_drug: 'Warfarin',
        section: 'warnings',
        snippet: 'Third retrieved label excerpt.',
        spl_set_id: 'SPL-3',
        effective_time: '20250303',
      },
    ],
  },
  literature: {
    status: 'ok',
    total_results: 12,
    returned_results: 1,
    search_url: 'https://pubmed.ncbi.nlm.nih.gov/?term=warfarin+aspirin',
    papers: [{
      pmid: '12345',
      title: 'A retrieved PubMed paper',
      authors: ['A. Author'],
      journal: 'Test Journal',
      publication_date: '2025',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345/',
    }],
  },
  limitations: ['Existing detailed limitation.'],
}

function renderEvidence() {
  return render(
    <MemoryRouter>
      <Evidence />
    </MemoryRouter>,
  )
}

async function retrieveEvidence(user) {
  await user.click(screen.getByRole('button', { name: 'Choose Drug A' }))
  await user.click(screen.getByRole('button', { name: 'Choose Drug B' }))
  await user.click(screen.getByRole('button', { name: 'Review evidence' }))
  return screen.findByRole('region', { name: 'Retrieved evidence summary' })
}

describe('Evidence retrieved-evidence summary', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('summarizes both FDA sources, mention counts, unique sections, and PubMed counts', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue(BASE_RESPONSE)
    renderEvidence()

    const summary = await retrieveEvidence(user)

    expect(within(summary).getByText('openFDA returned label records for both medicines.')).toBeVisible()
    expect(within(summary).getByText('Warfarin: label records retrieved. 2 label record(s) examined.')).toBeVisible()
    expect(within(summary).getByText('Aspirin: label records retrieved. 3 label record(s) examined.')).toBeVisible()
    expect(within(summary).getByText(/3 explicit cross-medicine name-mention excerpts were retrieved/)).toHaveTextContent(
      'Sections: Drug interactions, Warnings.',
    )
    expect(within(summary).getByText('PubMed returned 1 of 12 name-matched records.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Explore graph context' })).toHaveAttribute(
      'href',
      '/graph?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    expect(screen.getByText('First retrieved label excerpt.')).toBeVisible()
    expect(screen.getByText('A retrieved PubMed paper')).toBeVisible()
    expect(screen.getByRole('link', { name: /View on PubMed/i })).toHaveAttribute(
      'href',
      'https://pubmed.ncbi.nlm.nih.gov/12345/',
    )
  })

  it('distinguishes one available FDA source from no matching label records and explains zero mentions', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue({
      ...BASE_RESPONSE,
      label_evidence: {
        drug_a: BASE_RESPONSE.label_evidence.drug_a,
        drug_b: { drug_name: 'Aspirin', status: 'no_matches', records_found: 0, records_examined: 0 },
        pair_evidence: [],
      },
    })
    renderEvidence()

    const summary = await retrieveEvidence(user)

    expect(within(summary).getByText('Label information was retrieved for one medicine; the other source returned no matching label records.')).toBeVisible()
    expect(within(summary).getByText('Aspirin: no matching label records.')).toBeVisible()
    expect(within(summary).getByText('No explicit cross-medicine name mention was retrieved from the checked label sections.')).toBeVisible()
    expect(within(summary).queryByText(/no interaction exists/i)).not.toBeInTheDocument()
  })

  it('keeps FDA no-matches and retrieval errors visibly distinct', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue({
      ...BASE_RESPONSE,
      label_evidence: {
        drug_a: { drug_name: 'Warfarin', status: 'no_matches', records_found: 0, records_examined: 0 },
        drug_b: { drug_name: 'Aspirin', status: 'error', error: 'temporarily unavailable' },
        pair_evidence: [],
      },
    })
    renderEvidence()

    const summary = await retrieveEvidence(user)

    expect(within(summary).getByText('Warfarin: no matching label records.')).toBeVisible()
    expect(within(summary).getByText('Aspirin: label retrieval unavailable.')).toBeVisible()
    expect(within(summary).getByText('One medicine returned no matching label records; retrieval for the other medicine was unavailable.')).toBeVisible()
  })

  it('reports PubMed no-results without treating it as a retrieval error', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue({
      ...BASE_RESPONSE,
      literature: { status: 'no_results', total_results: 0, returned_results: 0, papers: [] },
    })
    renderEvidence()

    const summary = await retrieveEvidence(user)

    expect(within(summary).getByText('PubMed returned no name-matched records for this pair.')).toBeVisible()
    expect(within(summary).queryByText('PubMed retrieval was unavailable.')).not.toBeInTheDocument()
  })

  it('reports a PubMed retrieval error separately from no results', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue({
      ...BASE_RESPONSE,
      literature: { status: 'error', error: 'temporarily unavailable', papers: [] },
    })
    renderEvidence()

    const summary = await retrieveEvidence(user)

    expect(within(summary).getByText('PubMed retrieval was unavailable.')).toBeVisible()
    expect(within(summary).queryByText(/returned no name-matched records/i)).not.toBeInTheDocument()
  })

  it('states the summary limits without introducing graph or model output', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue(BASE_RESPONSE)
    renderEvidence()

    const summary = await retrieveEvidence(user)

    expect(within(summary).getByText(/do not determine interaction severity, probability, or personal safety/i)).toBeVisible()
    expect(within(summary).getByText(/missing evidence is not proof of safety/i)).toBeVisible()
    expect(summary).not.toHaveTextContent(/graph|R-GCN|model|score/i)
    expect(screen.getByText('Existing detailed limitation.')).toBeVisible()
  })
})
