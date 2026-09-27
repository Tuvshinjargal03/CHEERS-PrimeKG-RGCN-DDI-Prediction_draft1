import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Home from './Home.jsx'

vi.mock('../components/PublicSearchBox.jsx', () => ({
  default: ({ onSearch }) => (
    <button type="button" onClick={() => onSearch('aspirin interaction')}>
      Run test search
    </button>
  ),
}))

function Destination() {
  const location = useLocation()
  return <p>Destination: {location.pathname}{location.search}</p>
}

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Home capability guidance', () => {
  it('renders four distinct capability categories', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'Four separate kinds of information' })

    expect(within(section).getByText('Grounded medicine and disease information')).toBeVisible()
    expect(within(section).getByText('External pair evidence')).toBeVisible()
    expect(within(section).getByText('Knowledge-graph context')).toBeVisible()
    expect(within(section).getByText('R-GCN research ranking')).toBeVisible()
    expect(within(section).getAllByRole('listitem')).toHaveLength(4)
  })

  it('prioritizes public actions and keeps secondary destinations available', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'Choose where to start' })

    expect(within(section).getByRole('link', { name: /Check Medicines/ })).toHaveAttribute('href', '/check')
    expect(within(section).getByRole('link', { name: /My Health/ })).toHaveAttribute('href', '/my-health')
    expect(within(section).getByRole('link', { name: 'Medicines' })).toHaveAttribute('href', '/medicines')
    expect(within(section).getByRole('link', { name: 'Diseases' })).toHaveAttribute('href', '/diseases')
    expect(within(section).getByRole('link', { name: /Explore graph context/ })).toHaveAttribute('href', '/graph')
  })

  it('keeps evidence, graph, model, and clinical-use boundaries distinct', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'Four separate kinds of information' })
    const note = screen.getByRole('complementary', { name: 'A research and information prototype' })

    expect(section).toHaveTextContent('openFDA label information and PubMed records are independent from the R-GCN score.')
    expect(section).toHaveTextContent('Missing evidence does not confirm non-interaction or safety.')
    expect(section).toHaveTextContent('not proof of interaction, causation, or safety')
    expect(section).toHaveTextContent('ranking score—not probability, risk, severity, confidence, diagnosis, or treatment advice')
    expect(note).toHaveTextContent('not clinical decision support')
    expect(note).toHaveTextContent('It cannot diagnose a condition')
    expect(note).toHaveTextContent('advise starting, stopping, or changing treatment')
    expect(note).toHaveTextContent('Missing interaction or evidence is not confirmation of safety.')
    expect(note).not.toHaveTextContent(/missing evidence (means|shows|proves).*safe/i)
  })

  it('keeps all four research destinations in the lower research gateway', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'Built on CHEERS knowledge-graph DDI research' })

    expect(within(section).getByRole('link', { name: /DDI Predictor/ })).toHaveAttribute('href', '/predictor')
    expect(within(section).getByRole('link', { name: /Experiments/ })).toHaveAttribute('href', '/experiments')
    expect(within(section).getByRole('link', { name: /Relation Analysis/ })).toHaveAttribute('href', '/relations')
    expect(within(section).getByRole('link', { name: /Methodology/ })).toHaveAttribute('href', '/methodology')
  })

  it('preserves Home search and existing quick actions', async () => {
    renderHome()

    expect(screen.getByRole('link', { name: /Check Medicines/ })).toHaveAttribute('href', '/check')
    expect(screen.getByRole('link', { name: /My Health/ })).toHaveAttribute('href', '/my-health')
    expect(screen.getByRole('link', { name: /Explore graph context/ })).toHaveAttribute('href', '/graph')
    expect(screen.getByRole('link', { name: 'Medicines' })).toHaveAttribute('href', '/medicines')
    expect(screen.getByRole('link', { name: 'Diseases' })).toHaveAttribute('href', '/diseases')

    await userEvent.click(screen.getByRole('button', { name: 'Run test search' }))
    expect(screen.getByText('Destination: /search?q=aspirin%20interaction')).toBeVisible()
  })
})
