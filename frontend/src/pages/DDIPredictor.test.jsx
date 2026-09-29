import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DDIPredictor from './DDIPredictor.jsx'
import { postJson } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ postJson: vi.fn() }))

vi.mock('../components/DrugAutocomplete.jsx', () => ({
  default: ({ label, selection, onSelect }) => (
    <div>
      <span>{label}</span>
      <button type="button" onClick={() => onSelect({ name: 'Warfarin', entity_id: 'DB00682', node_id: 1 })}>
        Choose Warfarin
      </button>
      {selection && <span>Selected: {selection.name} · {selection.entity_id}</span>}
    </div>
  ),
}))

vi.mock('../components/MedicineLabelScanner.jsx', () => ({
  default: ({ targetLabel }) => <button type="button">Scan medicine label for {targetLabel}</button>,
}))

const response = {
  query: { name: 'Warfarin', entity_id: 'DB00682' },
  model: { graph: 'G3', seed: 44, best_epoch: 120 },
  candidate_drug_count: 7957,
  known_positive_candidates_filtered: 12,
  available_unobserved_candidates: 7944,
  predictions: [{ rank: 1, name: 'Aspirin', entity_id: 'DB00945', raw_score: 2.345678 }],
  disclaimer: 'Backend research disclaimer remains visible.',
}

function Destination() {
  const location = useLocation()
  return <p>Destination: {location.pathname}{location.search}</p>
}

function renderPredictor() {
  render(
    <MemoryRouter initialEntries={['/predictor']}>
      <Routes>
        <Route path="/predictor" element={<DDIPredictor />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function selectAndRun(topK = '10') {
  await userEvent.click(screen.getByRole('button', { name: 'Choose Warfarin' }))
  await userEvent.selectOptions(screen.getByRole('combobox'), topK)
  await userEvent.click(screen.getByRole('button', { name: 'Run R-GCN ranking' }))
}

describe('DDI Predictor research workflow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects a query medicine, enables ranking, and posts the unchanged API shape', async () => {
    postJson.mockResolvedValue(response)
    renderPredictor()

    const action = screen.getByRole('button', { name: 'Run R-GCN ranking' })
    expect(action).toBeDisabled()
    expect(screen.getByText('Scan a medicine label')).toBeVisible()
    expect(screen.getByText('Use your camera or an image to help find a medicine name.')).toBeVisible()
    expect(screen.queryByText(/does not identify a medicine clinically/i)).not.toBeInTheDocument()
    const headingMeta = screen.getByText('RESEARCH MODEL').parentElement
    expect(within(headingMeta).getByRole('link', { name: '← Research overview' })).toBeVisible()
    expect(screen.getByText(/does not mean there is no interaction/i)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Choose Warfarin' }))
    expect(screen.getByText('Selected: Warfarin · DB00682')).toBeVisible()
    expect(action).toBeEnabled()
    await userEvent.selectOptions(screen.getByRole('combobox'), '20')
    await userEvent.click(action)

    expect(postJson).toHaveBeenCalledWith('/api/predict', { drug: 'DB00682', top_k: 20 })
    expect(await screen.findByText('Prediction overview')).toBeVisible()
  })

  it('keeps an accessible loading state and displays request errors', async () => {
    let rejectRequest
    postJson.mockReturnValue(new Promise((resolve, reject) => { rejectRequest = reject }))
    renderPredictor()
    await selectAndRun('5')

    expect(screen.getByRole('status')).toHaveTextContent('Ranking possible interaction links')
    rejectRequest(new Error('HTTP 503 Runtime unavailable'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Research ranking is temporarily unavailable. Try again.')
    expect(screen.getByRole('alert')).not.toHaveTextContent(/HTTP|runtime/i)
  })

  it('renders metadata, raw ranked output, and interpretation boundaries', async () => {
    postJson.mockResolvedValue(response)
    renderPredictor()
    await selectAndRun()

    expect(await screen.findByText('Prediction overview')).toBeVisible()
    expect(screen.getByText('Saved trained model')).toBeVisible()
    await userEvent.click(screen.getByText('Model details'))
    expect(screen.getByText('Graph version: G3 (combined context)')).toBeVisible()
    expect(screen.getByText('Training run: seed 44')).toBeVisible()
    expect(screen.getByText('7,957 drugs')).toBeVisible()
    expect(screen.getByText(/12 known training-graph links excluded/)).toBeVisible()
    expect(screen.getByText('#1')).toBeVisible()
    expect(screen.getByText('Aspirin')).toBeVisible()
    expect(screen.getByText('DrugBank · DB00945')).toBeVisible()
    expect(screen.getByText('2.3457')).toBeVisible()
    expect(screen.getByText('Not observed in the training graph')).toBeVisible()
    expect(screen.getByText(/not a medical risk or probability/i)).toBeVisible()
    expect(screen.getByText('Backend research disclaimer remains visible.')).toBeVisible()

    const followUp = screen.getByLabelText('How to interpret follow-up views')
    expect(followUp).toHaveTextContent('does not validate the prediction')
    expect(followUp).toHaveTextContent('independent FDA/PubMed information')
    expect(followUp).toHaveTextContent('does not validate, modify, or calibrate the R-GCN score')

    const page = screen.getByRole('heading', { name: 'DDI Research Predictor' }).closest('section')
    expect(page).not.toHaveTextContent('Verified exported G3 runtime')
    expect(page.querySelector('.page-heading')).not.toHaveTextContent(/seed 44|checkpoint|runtime/i)
    expect(page).not.toHaveTextContent(/interaction probability|clinical risk score|best model|superior model|most accurate model|proven strongest model/i)
    expect(within(page).queryByText(/^(safe|unsafe)$/i)).not.toBeInTheDocument()
  })

  it.each([
    ['Graph context', '/graph'],
    ['Review evidence', '/evidence'],
  ])('preserves IDs and raw score for %s navigation', async (actionName, path) => {
    postJson.mockResolvedValue(response)
    renderPredictor()
    await selectAndRun()
    await screen.findByText('Prediction overview')

    await userEvent.click(screen.getByRole('button', { name: actionName }))
    expect(screen.getByText(`Destination: ${path}?drug_a_id=DB00682&drug_b_id=DB00945&score=2.345678`)).toBeVisible()
  })
})
