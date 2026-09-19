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
    const section = screen.getByRole('region', { name: 'What can CHEERS help with?' })

    expect(within(section).getByText('Source-backed medicine and disease information')).toBeVisible()
    expect(within(section).getByText('External pair evidence')).toBeVisible()
    expect(within(section).getByText('Graph context')).toBeVisible()
    expect(within(section).getByText('R-GCN research ranking')).toBeVisible()
    expect(within(section).getAllByRole('listitem')).toHaveLength(4)
  })

  it('links every capability to its existing destination', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'What can CHEERS help with?' })

    expect(within(section).getByRole('link', { name: 'Browse medicines' })).toHaveAttribute('href', '/medicines')
    expect(within(section).getByRole('link', { name: 'Browse diseases' })).toHaveAttribute('href', '/diseases')
    expect(within(section).getByRole('link', { name: 'Check medicines' })).toHaveAttribute('href', '/check')
    expect(within(section).getByRole('link', { name: 'Explore graph' })).toHaveAttribute('href', '/graph')
    expect(within(section).getByRole('link', { name: 'Open Research Predictor' })).toHaveAttribute('href', '/predictor')
  })

  it('states the graph, model, and missing-evidence boundaries', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'What can CHEERS help with?' })
    const note = screen.getByRole('complementary', { name: 'Information, not a personal prescription' })

    expect(section).toHaveTextContent('Shared graph context is not an interaction or safety verdict.')
    expect(section).toHaveTextContent('not clinical probability, severity, confidence, or risk')
    expect(note).toHaveTextContent('It cannot diagnose a condition')
    expect(note).toHaveTextContent('advise starting, stopping, or changing treatment')
    expect(note).toHaveTextContent('Missing evidence and high model scores are not clinical conclusions.')
    expect(note).not.toHaveTextContent(/missing evidence (means|shows|proves).*safe/i)
  })

  it('preserves Home search and existing quick actions', async () => {
    renderHome()

    expect(screen.getByRole('link', { name: /Check medicines together/ })).toHaveAttribute('href', '/check')
    expect(screen.getByRole('link', { name: /My Health/ })).toHaveAttribute('href', '/my-health')
    expect(screen.getByRole('link', { name: /Explore connections/ })).toHaveAttribute('href', '/graph')
    expect(screen.getByRole('link', { name: 'Medicines' })).toHaveAttribute('href', '/medicines')
    expect(screen.getByRole('link', { name: 'Diseases' })).toHaveAttribute('href', '/diseases')

    await userEvent.click(screen.getByRole('button', { name: 'Run test search' }))
    expect(screen.getByText('Destination: /search?q=aspirin%20interaction')).toBeVisible()
  })
})
