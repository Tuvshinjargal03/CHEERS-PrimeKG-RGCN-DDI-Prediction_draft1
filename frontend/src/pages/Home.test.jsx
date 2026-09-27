import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Home from './Home.jsx'

vi.mock('../components/PublicSearchBox.jsx', () => ({
  default: ({ onSearch }) => <button type="button" onClick={() => onSearch('aspirin interaction')}>Run test search</button>,
}))

function Destination() {
  const location = useLocation()
  return <p>Destination: {location.pathname}{location.search}</p>
}

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes><Route path="/" element={<Home />} /><Route path="*" element={<Destination />} /></Routes>
    </MemoryRouter>,
  )
}

describe('Home product hierarchy', () => {
  it('shows three clear primary actions without the old floating paragraph', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'Choose what you want to do' })
    expect(within(section).getByRole('link', { name: /Ask about a medicine/ })).toHaveAttribute('href', '/search')
    expect(within(section).getByRole('link', { name: /Check Medicines/ })).toHaveAttribute('href', '/check')
    expect(within(section).getByRole('link', { name: /My Health/ })).toHaveAttribute('href', '/my-health')
    expect(section).toHaveTextContent('Find medicine information, compare medicines, or use your saved health information.')
    expect(screen.queryByText(/without reading a long guide first/i)).not.toBeInTheDocument()
  })

  it('keeps direct browsing separate from the primary actions', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'Browse information' })
    expect(within(section).getByRole('link', { name: 'Medicines' })).toHaveAttribute('href', '/medicines')
    expect(within(section).getByRole('link', { name: 'Diseases' })).toHaveAttribute('href', '/diseases')
  })

  it('uses four compact information types and preserves concise boundaries', () => {
    renderHome()
    const section = screen.getByRole('region', { name: 'How CHEERS organizes information' })
    expect(within(section).getByText('Medicine & disease info')).toBeVisible()
    expect(within(section).getByText('FDA & PubMed evidence')).toBeVisible()
    expect(within(section).getByText('Research connections')).toBeVisible()
    expect(within(section).getByText('Model results')).toBeVisible()
    expect(within(section).getAllByRole('listitem')).toHaveLength(4)
    expect(section).toHaveTextContent('does not prove a clinical interaction')
    expect(section).toHaveTextContent('not clinical safety or risk scores')
    expect(document.body).not.toHaveTextContent(/\bG3\b/)
  })

  it('keeps advanced and research destinations secondary but available', () => {
    renderHome()
    const advanced = screen.getByRole('region', { name: 'Advanced exploration' })
    expect(within(advanced).getByRole('link', { name: 'Explore relationships' })).toHaveAttribute('href', '/graph')
    const research = screen.getByRole('region', { name: 'Explore the research behind CHEERS' })
    expect(within(research).getByRole('link', { name: 'DDI Predictor' })).toHaveAttribute('href', '/predictor')
    expect(within(research).getByRole('link', { name: 'Experiments' })).toHaveAttribute('href', '/experiments')
    expect(within(research).getByRole('link', { name: 'Relation Analysis' })).toHaveAttribute('href', '/relations')
    expect(within(research).getByRole('link', { name: 'Methodology' })).toHaveAttribute('href', '/methodology')
  })

  it('preserves search routing and the compact prototype boundary', async () => {
    renderHome()
    const note = screen.getByRole('complementary', { name: 'Important' })
    expect(note).toHaveTextContent('does not diagnose conditions, choose treatments, or confirm that a medicine combination is safe')
    await userEvent.click(screen.getByRole('button', { name: 'Run test search' }))
    expect(screen.getByText('Destination: /search?q=aspirin%20interaction')).toBeVisible()
  })
})
