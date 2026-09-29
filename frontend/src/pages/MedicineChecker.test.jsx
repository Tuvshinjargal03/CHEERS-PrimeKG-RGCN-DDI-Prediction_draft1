import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson, resolveDrug } from '../lib/api.js'
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
vi.mock('../components/MedicineLabelScanner.jsx', () => ({
  default: ({ targetLabel }) => <button type="button">Scan medicine label for {targetLabel}</button>,
}))
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

function renderChecker(entry = '/check') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
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
    resolveDrug.mockReset()
  })

  it('presents text search as the primary two-step workflow and scanning as optional', async () => {
    const user = userEvent.setup()
    renderChecker()

    expect(screen.getByText('Choose the first medicine')).toBeVisible()
    expect(screen.getByText('Choose the second medicine')).toBeVisible()
    expect(screen.getAllByText('Scan a medicine label')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Scan medicine label for First medicine' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Scan medicine label for Second medicine' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Check available information' })).toBeDisabled()
    expect(screen.getByText('Choose two different medicines above')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Choose First medicine' }))
    await user.click(screen.getByRole('button', { name: 'Choose Second medicine' }))

    expect(screen.getByLabelText('Selected medicine pair')).toHaveTextContent(/1Warfarin2Aspirin/)
    expect(screen.getByRole('button', { name: 'Check available information' })).toBeEnabled()
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
    const summary = screen.getByLabelText('Checked information summary')
    expect(within(summary).getByText('FDA label mentions').parentElement).toHaveTextContent('1FDA label mentionsRetrieved result')
    expect(within(summary).getByText('Research articles').parentElement).toHaveTextContent('1Research articlesPubMed · Retrieved result')
    expect(within(summary).getByText('Shared biomedical connections').parentElement).toHaveTextContent('4Shared biomedical connectionsAvailable context')
    const statusBoundary = screen.getByText(/This status summarizes retrieved sources/)
    expect(statusBoundary).toHaveTextContent('not an interaction-severity or personal-safety assessment')
    expect(statusBoundary).toHaveTextContent('does not guarantee that the combination is safe for a specific person')

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

    expect(await screen.findByRole('link', { name: /review evidence/i })).toHaveAttribute(
      'href',
      '/evidence?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    expect(screen.getByRole('link', { name: /explore graph/i })).toHaveAttribute(
      'href',
      '/graph?drug_a_id=DB00682&drug_b_id=DB00945',
    )
    expect(screen.getByRole('link', { name: /open research Predictor/i })).toHaveAttribute('href', '/predictor')
    expect(screen.getByText('Optional research only')).toBeVisible()
    const evidenceLink = screen.getByRole('link', { name: /review evidence/i })
    const graphLink = screen.getByRole('link', { name: /explore graph/i })
    const researchLink = screen.getByRole('link', { name: /open research Predictor/i })
    expect(evidenceLink.compareDocumentPosition(graphLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(graphLink.compareDocumentPosition(researchLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    expect(screen.getByRole('alert')).toHaveTextContent('The checked sources could not be retrieved. Please try again.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Sources are temporarily unavailable.')
    expect(screen.getByText(/4 shared connections found/)).toBeVisible()
    expect(screen.getByText('FDA label mentions').parentElement).toHaveTextContent('—FDA label mentionsSource unavailable')
  })

  it('keeps evidence visible when graph context retrieval fails', async () => {
    const user = userEvent.setup()
    getJson.mockImplementation((path) => (
      path.startsWith('/api/evidence')
        ? Promise.resolve(RED_EVIDENCE)
        : Promise.reject(new Error('Graph context is temporarily unavailable.'))
    ))
    renderChecker()

    await choosePairAndSubmit(user)

    expect(await screen.findByText('Interaction warning found')).toBeVisible()
    expect(screen.getByText('An explicit label interaction mention.')).toBeVisible()
    expect(screen.getByText('A source-backed paper')).toBeVisible()
    expect(screen.getByText('Shared research connections could not be displayed')).toBeVisible()
    expect(screen.getByText('Research connections are temporarily unavailable.')).toBeVisible()
    const summary = screen.getByLabelText('Checked information summary')
    expect(within(summary).getByText('Shared biomedical connections').parentElement).toHaveTextContent('—Shared biomedical connectionsContext unavailable')
  })

  it('resolves and populates medicines from the existing query parameters', async () => {
    resolveDrug.mockImplementation((id) => Promise.resolve(id === WARFARIN.entity_id ? WARFARIN : ASPIRIN))
    renderChecker('/check?drug_a_id=DB00682&drug_b_id=DB00945')

    expect(await screen.findByLabelText('Selected medicine pair')).toHaveTextContent(/1Warfarin2Aspirin/)
    expect(resolveDrug).toHaveBeenNthCalledWith(1, 'DB00682')
    expect(resolveDrug).toHaveBeenNthCalledWith(2, 'DB00945')
    expect(screen.getByRole('button', { name: 'Check available information' })).toBeEnabled()
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
    expect(screen.getByText(/does not replace advice from a healthcare professional/i)).toBeVisible()
  })
})
