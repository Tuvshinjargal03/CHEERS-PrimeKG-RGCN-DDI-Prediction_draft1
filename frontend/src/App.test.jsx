import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App.jsx'

describe('CHEERS application shell', () => {
  beforeEach(() => {
    window.location.hash = '#/overview'
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
    expect(nav.getByRole('link', { name: 'My Medicines' })).toHaveAttribute('href', '#/my-medicines')
    expect(nav.getByRole('link', { name: 'My Conditions' })).toHaveAttribute('href', '#/my-conditions')
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
})
