import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import MedicineChecker from './MedicineChecker.jsx'

const WARFARIN = { name: 'Warfarin', entity_id: 'DB00682', node_id: 682 }
const ASPIRIN = { name: 'Aspirin', entity_id: 'DB00945', node_id: 945 }

vi.mock('../components/DrugAutocomplete.jsx', () => ({
  default: ({ label, selection, onSelect }) => (
    <button type="button" onClick={() => onSelect(label === 'First medicine' ? WARFARIN : ASPIRIN)}>
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

const RED_EVIDENCE = {
  label_evidence: {
    evidence_found: true,
    source_url: 'https://api.fda.gov/drug/label.json',
    pair_evidence: [{
      source_drug: 'Warfarin',
      mentioned_drug: 'Aspirin',
      section: 'drug_interactions',
      snippet: 'An explicit label interaction mention.',
    }],
  },
  literature: {
    status: 'ok',
    papers: [{
      pmid: '12345',
      title: 'A source-backed paper',
      journal: 'Test Journal',
      publication_date: '2025',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345/',
    }],
  },
}

const CONTEXT = {
  shared: { total: 4, gene_protein_count: 3, disease_count: 1, entities: [] },
}

function renderChecker() {
  return render(
    <MemoryRouter>
      <MedicineChecker />
    </MemoryRouter>,
  )
}

async function choosePairAndSubmit(user) {
  await user.click(screen.getByRole('button', { name: 'Choose First medicine' }))
  await user.click(screen.getByRole('button', { name: 'Choose Second medicine' }))
  await user.click(screen.getByRole('button', { name: 'Check available information' }))
}

describe('MedicineChecker', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('retrieves pair sources and presents explicit label information', async () => {
    const user = userEvent.setup()
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/evidence') ? RED_EVIDENCE : CONTEXT))
    renderChecker()

    await choosePairAndSubmit(user)

    expect(await screen.findByText('Interaction warning found')).toBeVisible()
    expect(screen.getByLabelText('Checked medicine pair')).toHaveTextContent(/Warfarin\+Aspirin/)
    expect(screen.getByText('An explicit label interaction mention.')).toBeVisible()
    expect(screen.getByText('A source-backed paper')).toBeVisible()
    expect(screen.getByText(/4 shared connections found/)).toBeVisible()

    const detailsButton = screen.getByRole('button', { name: 'View label details' })
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(detailsButton)
    expect(detailsButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('provides the existing evidence, graph, and research deep links', async () => {
    const user = userEvent.setup()
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/evidence') ? RED_EVIDENCE : CONTEXT))
    renderChecker()

    await choosePairAndSubmit(user)

    expect(await screen.findByRole('link', { name: /open full source view/i })).toHaveAttribute(
      'href',
      '/evidence?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    expect(screen.getByRole('link', { name: /explore graph/i })).toHaveAttribute(
      'href',
      '/graph?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    expect(screen.getByRole('link', { name: /open research Predictor/i })).toHaveAttribute('href', '/predictor')
  })

  it('uses needs-review for literature without an explicit label mention', async () => {
    const user = userEvent.setup()
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/evidence')
      ? {
          label_evidence: { evidence_found: false, pair_evidence: [] },
          literature: { papers: [{ pmid: '9', title: 'Related literature' }] },
        }
      : CONTEXT))
    renderChecker()

    await choosePairAndSubmit(user)
    expect(await screen.findByText('Needs review')).toBeVisible()
  })

  it('uses the insufficient state when source retrieval fails', async () => {
    const user = userEvent.setup()
    getJson.mockImplementation((path) => (
      path.startsWith('/api/evidence')
        ? Promise.reject(new Error('Sources are temporarily unavailable.'))
        : Promise.resolve(CONTEXT)
    ))
    renderChecker()

    await choosePairAndSubmit(user)

    expect(await screen.findByText('Not enough information')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Sources are temporarily unavailable.')
  })

  it('never presents a forbidden safety verdict', async () => {
    const user = userEvent.setup()
    getJson.mockImplementation((path) => Promise.resolve(path.startsWith('/api/evidence') ? RED_EVIDENCE : CONTEXT))
    renderChecker()

    await choosePairAndSubmit(user)

    await screen.findByText('Interaction warning found')
    expect(screen.queryByText(/^safe$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^unsafe$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/clinical risk probability/i)).not.toBeInTheDocument()
  })
})
