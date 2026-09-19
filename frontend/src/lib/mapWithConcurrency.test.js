import { describe, expect, it, vi } from 'vitest'
import { mapWithConcurrency } from './mapWithConcurrency.js'

describe('mapWithConcurrency', () => {
  it('isolates synchronous worker failures and retains each input index', async () => {
    const onResult = vi.fn()
    await mapWithConcurrency(['first', 'broken', 'last'], 1, (item) => {
      if (item === 'broken') throw new Error('unavailable')
      return item
    }, onResult)

    expect(onResult.mock.calls).toEqual([
      [{ status: 'fulfilled', value: 'first' }, 0],
      [{ status: 'rejected', reason: expect.any(Error) }, 1],
      [{ status: 'fulfilled', value: 'last' }, 2],
    ])
  })

  it('stops queued work and suppresses delivery when the run is invalidated', async () => {
    let cancelled = false
    const settle = []
    const worker = vi.fn(() => new Promise((resolve) => settle.push(resolve)))
    const onResult = vi.fn()
    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5], 4, worker, onResult, () => cancelled)

    expect(worker).toHaveBeenCalledTimes(4)
    cancelled = true
    settle.forEach((resolve) => resolve('stale'))
    await run
    expect(worker).toHaveBeenCalledTimes(4)
    expect(onResult).not.toHaveBeenCalled()
  })

  it('does not start empty or already cancelled work', async () => {
    const worker = vi.fn()
    const onResult = vi.fn()
    await mapWithConcurrency([], 4, worker, onResult)
    await mapWithConcurrency([1], 4, worker, onResult, () => true)
    expect(worker).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5])('rejects invalid concurrency %s', async (limit) => {
    await expect(mapWithConcurrency([1], limit, vi.fn(), vi.fn())).rejects.toThrow(RangeError)
  })
})
