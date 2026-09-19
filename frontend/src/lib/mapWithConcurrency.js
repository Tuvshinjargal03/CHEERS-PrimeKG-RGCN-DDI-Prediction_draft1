// Report each settled item immediately, retaining its original input index.
// Cancellation stops queued work and delivery; already-started workers may settle.
export async function mapWithConcurrency(items, limit, worker, onResult, isCancelled = () => false) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Concurrency limit must be a positive integer.')
  }

  let nextIndex = 0

  async function runWorker() {
    while (!isCancelled() && nextIndex < items.length) {
      const index = nextIndex++
      let result
      try {
        result = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        result = { status: 'rejected', reason }
      }
      if (isCancelled()) return
      onResult(result, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker))
}
