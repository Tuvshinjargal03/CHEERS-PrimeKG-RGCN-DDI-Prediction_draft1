import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DrugAutocomplete from './DrugAutocomplete.jsx'
import { getJson } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ getJson: vi.fn() }))

const ASPIRIN = { name: 'Aspirin', entity_id: 'DB00945', node_id: 101 }
const CANONICAL_ASPIRIN = { name: 'Acetylsalicylic acid', entity_id: 'DB00945', node_id: 101 }
const AMPICILLIN = { name: 'Ampicillin', entity_id: 'DB00415', node_id: 102 }
const LONG_CANONICAL_NAME = {
  name: '(R)-warfarin sodium 2-(13C)-isotope reference compound',
  entity_id: 'DB08496',
  node_id: 103,
}

function searchResponse(results, hasMore = false, commonResults = []) {
  return { results, has_more: hasMore, common_results: commonResults }
}

function renderAutocomplete(onSelect = vi.fn(), props = {}) {
  render(
    <DrugAutocomplete
      label="Query drug"
      selection={null}
      onSelect={onSelect}
      {...props}
    />,
  )
  return { input: screen.getByRole('combobox', { name: 'Query drug' }), onSelect }
}

describe('DrugAutocomplete', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('loads the first bounded inventory page on empty focus', async () => {
    const user = userEvent.setup()
    getJson.mockResolvedValue(searchResponse([ASPIRIN]))
    const { input } = renderAutocomplete()

    await user.click(input)

    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('All medicines')).toBeVisible()
    expect(within(listbox).getByRole('option', { name: /Aspirin/ })).toBeVisible()
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=&limit=50&offset=0')
  })

  it('pins verified common medicines before the complete inventory without duplicates', async () => {
    getJson.mockResolvedValue(searchResponse(
      [CANONICAL_ASPIRIN, AMPICILLIN, LONG_CANONICAL_NAME],
      false,
      [CANONICAL_ASPIRIN],
    ))
    const { input } = renderAutocomplete()
    fireEvent.focus(input)
    const listbox = await screen.findByRole('listbox')
    const headings = within(listbox).getAllByText(/Common medicines|All medicines/)
    expect(headings.map((heading) => heading.textContent)).toEqual(['Common medicines', 'All medicines'])
    expect(await within(listbox).findAllByRole('option', { name: /Aspirin/ })).toHaveLength(1)
    expect(within(listbox).getByText('Acetylsalicylic acid')).toBeVisible()
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
  })

  it('resets typed search pagination and returns to browse mode when cleared', async () => {
    const user = userEvent.setup()
    getJson.mockImplementation((path) => Promise.resolve(
      path.includes('q=amp') ? searchResponse([AMPICILLIN]) : searchResponse([ASPIRIN]),
    ))
    const { input } = renderAutocomplete()

    await user.click(input)
    await screen.findByRole('option', { name: /Aspirin/ })
    fireEvent.change(input, { target: { value: 'amp' } })
    expect(await screen.findByRole('option', { name: /Ampicillin/ })).toBeVisible()
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=amp&limit=50&offset=0')
    fireEvent.change(input, { target: { value: '' } })
    expect(await screen.findByText('All medicines')).toBeVisible()
    await waitFor(() => expect(getJson).toHaveBeenLastCalledWith('/api/drugs/search?q=&limit=50&offset=0'))
  })

  it('accepts and searches a one-character query', async () => {
    getJson.mockResolvedValue(searchResponse([ASPIRIN]))
    const { input } = renderAutocomplete()

    fireEvent.change(input, { target: { value: 'a' } })

    await screen.findByRole('option', { name: /Aspirin/ })
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=a&limit=50&offset=0')
  })

  it.each(['asp', 'aspi', 'aspir', 'aspirin'])('presents and selects verified Aspirin for %s', async (query) => {
    const user = userEvent.setup()
    getJson.mockResolvedValue(searchResponse([CANONICAL_ASPIRIN]))
    const { input, onSelect } = renderAutocomplete()

    fireEvent.change(input, { target: { value: query } })
    const option = await screen.findByRole('option', { name: /Aspirin/ })
    expect(within(option).getByText('Aspirin')).toBeVisible()
    expect(within(option).getByText('Acetylsalicylic acid')).toBeVisible()
    await user.click(option)

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'DB00945' }))
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

  it('appends the next empty-query inventory page without replacing existing results', async () => {
    getJson
      .mockResolvedValueOnce(searchResponse([ASPIRIN], true))
      .mockResolvedValueOnce(searchResponse([AMPICILLIN], false))
    const { input } = renderAutocomplete()
    fireEvent.focus(input)
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
    expect(getJson).toHaveBeenLastCalledWith('/api/drugs/search?q=&limit=50&offset=1')
  })

  it('applies a research scope to empty browse, typed search, and pagination', async () => {
    getJson
      .mockResolvedValueOnce(searchResponse([CANONICAL_ASPIRIN], true, [CANONICAL_ASPIRIN]))
      .mockResolvedValueOnce(searchResponse([AMPICILLIN], false))
      .mockResolvedValueOnce(searchResponse([CANONICAL_ASPIRIN], false))
    const { input } = renderAutocomplete(vi.fn(), { searchScope: 'context' })
    fireEvent.focus(input)
    const listbox = await screen.findByRole('listbox')
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=&limit=50&offset=0&scope=context')
    expect(await within(listbox).findAllByRole('option', { name: /Aspirin/ })).toHaveLength(1)
    Object.defineProperties(listbox, {
      scrollHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, value: 150 },
      clientHeight: { configurable: true, value: 50 },
    })
    fireEvent.scroll(listbox)
    await within(listbox).findByRole('option', { name: /Ampicillin/ })
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=&limit=50&offset=1&scope=context')

    fireEvent.change(input, { target: { value: 'aspirin' } })
    await screen.findByRole('option', { name: /Aspirin/ })
    expect(getJson).toHaveBeenCalledWith('/api/drugs/search?q=aspirin&limit=50&offset=0&scope=context')
  })

  it('does not add availability annotations unless the optional prop is supplied', async () => {
    getJson.mockResolvedValue(searchResponse([ASPIRIN]))
    const { input } = renderAutocomplete()

    fireEvent.change(input, { target: { value: 'a' } })

    expect(await screen.findByRole('option', { name: /Aspirin/ })).toBeVisible()
    expect(screen.queryByText('Research connections')).not.toBeInTheDocument()
  })

  it('keeps the full canonical identity accessible while presenting secondary metadata', async () => {
    getJson.mockResolvedValue(searchResponse([LONG_CANONICAL_NAME]))
    render(
      <DrugAutocomplete
        label="Query drug"
        selection={null}
        onSelect={vi.fn()}
        getOptionAnnotation={() => ({ available: true, label: 'Research connections available' })}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Query drug' }), {
      target: { value: 'warfarin' },
    })

    const option = await screen.findByRole('option', { name: new RegExp(LONG_CANONICAL_NAME.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    expect(option).toHaveAccessibleName(expect.stringContaining(LONG_CANONICAL_NAME.name))
    expect(within(option).getByText(LONG_CANONICAL_NAME.name)).toHaveAttribute('title', LONG_CANONICAL_NAME.name)
    expect(within(option).queryByText(/DB08496/)).not.toBeInTheDocument()
    expect(within(option).getByText('Research connections available')).toBeVisible()
  })
})
