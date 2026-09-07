import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import InfoTooltip from './InfoTooltip.jsx'

describe('InfoTooltip', () => {
  it('opens on hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup()
    render(<InfoTooltip label="Explain MRR" text="Mean Reciprocal Rank explanation." />)
    const trigger = screen.getByRole('button', { name: 'Explain MRR' })

    await user.hover(trigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Mean Reciprocal Rank explanation.')

    await user.unhover(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('supports click, focus, and Escape keyboard behavior', async () => {
    const user = userEvent.setup()
    render(<InfoTooltip label="Explain paired interval" text="Pointwise paired interval." />)
    const trigger = screen.getByRole('button', { name: 'Explain paired interval' })

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tooltip')).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.tab()
    await user.tab({ shift: true })
    expect(screen.getByRole('tooltip')).toBeVisible()
  })
})
