import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DrugAutocomplete from './DrugAutocomplete.jsx'
import { getJson } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ getJson: vi.fn() }))

const ASPIRIN = { name: 'Aspirin', entity_id: 'DB00945', node_id: 101 }
const AMPICILLIN = { name: 'Ampicillin', entity_id: 'DB00415', node_id: 102 }

function searchResponse(results, hasMore = false) {
  return { results, has_more: hasMore }
}

function renderAutocomplete(onSelect = vi.fn()) {
  render(
    <DrugAutocomplete
      label="Query drug"
      selection={null}
      onSelect={onSelect}
    />,
  )
  return { input: screen.getByRole('combobox', { name: 'Query drug' }), onSelect }
}

describe('DrugAutocomplete', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('opens an empty browse, renders suggestions, and selects a result', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue(searchResponse([ASPIRIN]))
    const { input, onSelect } = renderAutocomplete()

    await user.click(input)

    expect(await screen.findByRole('option', { name: /Aspirin/ })).toBeVisible()
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=&limit=50&offset=0')
    await user.click(screen.getByRole('option', { name: /Aspirin/ }))
    expect(onSelect).toHaveBeenCalledWith(ASPIRIN)
  })

  it('accepts and searches a one-character query', async () => {
    getJson.mockResolvedValue(searchResponse([ASPIRIN]))
    const { input } = renderAutocomplete()

    fireEvent.change(input, { target: { value: 'a' } })

    await screen.findByRole('option', { name: /Aspirin/ })
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=a&limit=50&offset=0')
  })

  it('supports ArrowDown, ArrowUp, and Enter selection', async () => {
    getJson.mockResolvedValue(searchResponse([ASPIRIN, AMPICILLIN]))
    const { input, onSelect } = renderAutocomplete()
    fireEvent.change(input, { target: { value: 'a' } })
    await screen.findByRole('option', { name: /Ampicillin/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Aspirin/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /Ampicillin/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(AMPICILLIN)
  })

  it('closes suggestions with Escape', async () => {
    getJson.mockResolvedValue(searchResponse([ASPIRIN]))
    const { input } = renderAutocomplete()
    fireEvent.change(input, { target: { value: 'a' } })
    await screen.findByRole('listbox')

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes suggestions on an outside pointer interaction', async () => {
    getJson.mockResolvedValue(searchResponse([ASPIRIN]))
    const { input } = renderAutocomplete()
    fireEvent.change(input, { target: { value: 'a' } })
    await screen.findByRole('listbox')

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ignores a stale response that resolves after a newer query', async () => {
    let resolveOld
    let resolveNew
    const oldResponse = new Promise((resolve) => { resolveOld = resolve })
    const newResponse = new Promise((resolve) => { resolveNew = resolve })
    getJson.mockImplementation((path) => path.includes('q=ab') ? newResponse : oldResponse)
    const { input } = renderAutocomplete()

    fireEvent.change(input, { target: { value: 'a' } })
    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(1))
    fireEvent.change(input, { target: { value: 'ab' } })
    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(2))

    resolveNew(searchResponse([AMPICILLIN]))
    expect(await screen.findByRole('option', { name: /Ampicillin/ })).toBeVisible()
    resolveOld(searchResponse([ASPIRIN]))
    await waitFor(() => expect(screen.queryByRole('option', { name: /Aspirin/ })).not.toBeInTheDocument())
  })

  it('appends the next page without replacing existing results', async () => {
    getJson
      .mockResolvedValueOnce(searchResponse([ASPIRIN], true))
      .mockResolvedValueOnce(searchResponse([AMPICILLIN], false))
    const { input } = renderAutocomplete()
    fireEvent.change(input, { target: { value: 'a' } })
    const listbox = await screen.findByRole('listbox')
    await within(listbox).findByRole('option', { name: /Aspirin/ })
    Object.defineProperties(listbox, {
      scrollHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, value: 150 },
      clientHeight: { configurable: true, value: 50 },
    })

    fireEvent.scroll(listbox)

    expect(await within(listbox).findByRole('option', { name: /Ampicillin/ })).toBeVisible()
    expect(within(listbox).getByRole('option', { name: /Aspirin/ })).toBeVisible()
    expect(getJson).toHaveBeenLastCalledWith('/api/drugs/search?q=a&limit=50&offset=1')
  })
})
