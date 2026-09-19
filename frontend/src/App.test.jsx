import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

vi.mock('./lib/api.js', async (importOriginal) => ({
  ...await importOriginal(),
  getJson: vi.fn().mockRejectedValue(new Error('Offline navigation fixture')),
}))

describe('CHEERS application shell', () => {
  beforeEach(() => {
    window.location.hash = '#/overview'
    window.localStorage.clear()
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('keeps public and research navigation destinations mounted', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Understand your medicines better.' })).toBeVisible()
    const navigation = screen.getByRole('navigation')
    const nav = within(navigation)
    expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '#/overview')
    expect(nav.getByRole('link', { name: 'My Health' })).toHaveAttribute('href', '#/my-health')
    expect(nav.getByRole('link', { name: 'Check Medicines' })).toHaveAttribute('href', '#/check')
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Check Medicines', 'My Health'])
    expect(nav.queryByRole('link', { name: 'My Medicines' })).not.toBeInTheDocument()
    expect(nav.queryByRole('link', { name: 'My Conditions' })).not.toBeInTheDocument()
    expect(nav.queryByRole('link', { name: 'Medicines' })).not.toBeInTheDocument()
    await user.click(nav.getByRole('button', { name: 'Browse' }))
    expect(nav.getByRole('link', { name: 'Medicines' })).toHaveAttribute('href', '#/medicines')
    expect(nav.getByRole('link', { name: 'Diseases' })).toHaveAttribute('href', '#/diseases')

    await user.click(nav.getByRole('button', { name: 'Explore' }))
    expect(nav.getByRole('link', { name: 'Graph Explorer' })).toHaveAttribute('href', '#/graph')
    expect(nav.getByRole('link', { name: 'Subgraph Explorer' })).toHaveAttribute('href', '#/subgraph')

    await user.click(nav.getByRole('button', { name: 'Research' }))
    expect(nav.getByRole('link', { name: 'DDI Predictor' })).toHaveAttribute('href', '#/predictor')
    expect(nav.getByRole('link', { name: 'Experiments' })).toHaveAttribute('href', '#/experiments')
    expect(nav.getByRole('link', { name: 'Relation Analysis' })).toHaveAttribute('href', '#/relations')
    expect(nav.getByRole('link', { name: 'Methodology' })).toHaveAttribute('href', '#/methodology')
  })

  it.each(['Browse', 'Explore', 'Research'])('preserves keyboard, Escape and outside-click behavior for %s', async (group) => {
    const user = userEvent.setup()
    render(<App />)
    const heading = await screen.findByRole('heading', { name: 'Understand your medicines better.' })
    const trigger = within(screen.getByRole('navigation')).getByRole('button', { name: group })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const submenu = document.getElementById(trigger.getAttribute('aria-controls'))
    await user.tab()
    expect(within(submenu).getAllByRole('link')[0]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard(' ')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.click(heading)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it.each([
    ['/medicines/DB00682', 'Medicines'],
    ['/diseases/5148', 'Diseases'],
  ])('keeps Browse expanded and the destination active on %s', async (path, label) => {
    window.location.hash = `#${path}`
    render(<App />)
    const nav = within(screen.getByRole('navigation'))
    expect(nav.getByRole('button', { name: 'Browse' })).toHaveAttribute('aria-expanded', 'true')
    expect(nav.getByRole('button', { name: 'Browse' })).toHaveClass('active')
    expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    await screen.findByRole('heading', { level: 1 })
  })

  it('mounts the My Medicines route without a sidebar entry', async () => {
    window.location.hash = '#/my-medicines'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Review your medicines together.' })).toBeVisible()
    expect(within(screen.getByRole('navigation')).queryByRole('link', { name: 'My Medicines' })).not.toBeInTheDocument()
  })

  it('mounts the My Conditions route', async () => {
    window.location.hash = '#/my-conditions'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Save conditions you want to explore in CHEERS.' })).toBeVisible()
  })

  it('mounts the My Health route', async () => {
    window.location.hash = '#/my-health'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Your selected medicines and conditions, brought together in one place.' })).toBeVisible()
  })

  it('restores scroll and main-content focus only when the pathname changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Understand your medicines better.' })
    expect(window.scrollTo).not.toHaveBeenCalled()

    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'My Health' }))
    await screen.findByRole('heading', { name: 'Your selected medicines and conditions, brought together in one place.' })

    const mainContent = document.getElementById('main-content')
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
    expect(mainContent).toHaveFocus()
    expect(mainContent).toHaveAttribute('tabindex', '-1')

    const researchTrigger = within(screen.getByRole('navigation')).getByRole('button', { name: 'Research' })
    await user.click(researchTrigger)
    expect(researchTrigger).toHaveFocus()
    expect(mainContent).not.toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
  })
})
