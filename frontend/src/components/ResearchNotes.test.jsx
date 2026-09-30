import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ResearchNotes from './ResearchNotes.jsx'

describe('ResearchNotes', () => {
  it('keeps detailed interpretation accessible in a neutral collapsed disclosure', async () => {
    render(<ResearchNotes summary="Read this result with its study limits."><p>Scores are ranking values, not probabilities.</p></ResearchNotes>)
    const details = screen.getByText('Interpretation notes').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('Scores are ranking values, not probabilities.')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Interpretation notes'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Scores are ranking values, not probabilities.')).toBeVisible()
  })
})
