import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import Methodology from './Methodology.jsx'

vi.mock('../lib/api.js', () => ({ getJson: vi.fn(() => new Promise(() => {})) }))

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}</output>
}

describe('Methodology section navigation', () => {
  it('scrolls every in-page section without changing the HashRouter route', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/methodology']}>
        <Routes>
          <Route path="/methodology" element={<><Methodology /><LocationProbe /></>} />
          <Route path="*" element={<p>Page not found</p>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(getJson).toHaveBeenCalledTimes(4)
    const headingMeta = screen.getByText('Controlled research design').closest('.research-heading-meta')
    expect(headingMeta).toContainElement(screen.getByRole('link', { name: /See Research overview/ }))
    const navigation = screen.getByRole('navigation', { name: 'Methodology sections' })
    const sectionLinks = within(navigation).getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('#'))
    const scrollIntoView = vi.fn()
    const getElementById = vi.spyOn(document, 'getElementById').mockReturnValue({ scrollIntoView })

    for (const link of sectionLinks) {
      const sectionId = link.getAttribute('href').slice(1)
      scrollIntoView.mockClear()
      await user.click(link)
      expect(getElementById).toHaveBeenLastCalledWith(sectionId)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      expect(screen.getByLabelText('Current route')).toHaveTextContent('/methodology')
      expect(screen.queryByText('Page not found')).not.toBeInTheDocument()
    }
  })
})
