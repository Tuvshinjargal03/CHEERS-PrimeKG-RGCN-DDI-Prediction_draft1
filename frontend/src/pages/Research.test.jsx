import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Research from './Research.jsx'

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}</output>
}

describe('Research overview', () => {
  it('explains the project question, graph variants, and exact five-seed result', () => {
    render(<MemoryRouter><Research /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Research', level: 1 })).toBeVisible()
    expect(screen.getByText(/Does adding different types of biomedical knowledge improve/)).toBeVisible()
    const comparison = screen.getByRole('region', { name: 'What did we compare?' })
    ;[
      ['G0', 'DDI only'], ['G1', 'Molecular context'],
      ['G2', 'Disease context'], ['G3', 'Combined context'],
    ].forEach(([code, label]) => {
      expect(within(comparison).getByText(code)).toBeVisible()
      expect(within(comparison).getByRole('heading', { name: label })).toBeVisible()
    })

    ;['0.5273', '0.5310', '0.5268', '0.5342'].forEach((value) => expect(screen.getByText(value)).toBeVisible())
    ;[
      'Mean 0.527284 ± 0.006373',
      'Mean 0.530969 ± 0.007414',
      'Mean 0.526776 ± 0.007482',
      'Mean 0.534209 ± 0.006288',
    ].forEach((value) => expect(screen.getByText(value)).toBeVisible())
    expect(screen.getByText('Highest observed mean')).toBeVisible()
    expect(screen.getByText(/difference from G0 was small and was not statistically conclusive/i)).toBeVisible()
    expect(screen.getByText('+0.006924')).toBeVisible()
    expect(screen.getByText('[-0.002624, +0.016473]')).toBeVisible()
    expect(screen.getByText('0.0625')).toBeVisible()
    expect(document.body).not.toHaveTextContent(/best model|winner|significantly better|proven improvement|superior model/i)
  })

  it('preserves relation limitations, dataset roles, and detailed-page access', () => {
    render(<MemoryRouter><Research /></MemoryRouter>)
    expect(screen.getByText(/Every paired interval included zero, so no individual relation type was proven beneficial/i)).toBeVisible()
    ;['+0.006766', '+0.002479', '+0.002107', '+0.001410', '-0.003531', '-0.003817', '-0.012625'].forEach((value) => expect(screen.getByText(value)).toBeVisible())
    expect(screen.getByText('1,336,314')).toBeVisible()
    expect(screen.getByText('1,069,080 / 133,620 / 133,614')).toBeVisible()
    expect(screen.getByText('13,094')).toBeVisible()
    expect(screen.getByText('4,278')).toBeVisible()
    expect(screen.getByText(/DDInter was used for exploratory external evaluation, not for training/)).toBeVisible()
    expect(screen.getByRole('link', { name: /Detailed results/ })).toHaveAttribute('href', '/experiments')
    expect(screen.getByRole('link', { name: /Relation analysis/ })).toHaveAttribute('href', '/relations')
    expect(screen.getByRole('link', { name: /Methodology/ })).toHaveAttribute('href', '/methodology')
    expect(screen.getByRole('link', { name: /Research Predictor/ })).toHaveAttribute('href', '/predictor')
  })

  it('scrolls every overview section link without changing the HashRouter route', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/research']}>
        <Routes>
          <Route path="/research" element={<><Research /><LocationProbe /></>} />
          <Route path="*" element={<p>Page not found</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const links = within(screen.getByRole('navigation', { name: 'Research overview sections' })).getAllByRole('link')
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    for (const link of links) {
      scrollIntoView.mockClear()
      await user.click(link)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      expect(screen.getByLabelText('Current route')).toHaveTextContent('/research')
      expect(screen.queryByText('Page not found')).not.toBeInTheDocument()
    }
  })
})
