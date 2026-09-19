const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

const getCache = new Map()
const pendingGets = new Map()

export async function apiRequest(path, options = {}) {
  const {
    headers: optionHeaders = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    ...requestOptions
  } = options

  const controller = new AbortController()
  let timedOut = false

  function handleExternalAbort() {
    controller.abort()
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', handleExternalAbort, {
        once: true,
      })
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(path, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...optionHeaders,
      },
    })

    if (!response.ok) {
      const detail = await response
        .json()
        .then((payload) => payload.detail || '')
        .catch(() => '')

      const error = new Error(
        detail || `Request failed with status ${response.status}.`,
      )
      error.status = response.status
      throw error
    }

    return response.json()
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(
        'This source is taking longer than expected. Please try again.',
      )
      timeoutError.code = 'REQUEST_TIMEOUT'
      throw timeoutError
    }

    throw error
  } finally {
    clearTimeout(timeoutId)

    if (externalSignal) {
      externalSignal.removeEventListener(
        'abort',
        handleExternalAbort,
      )
    }
  }
}

export function getJson(path, options = {}) {
  const {
    cache = true,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    ...requestOptions
  } = options

  if (!cache) {
    return apiRequest(path, requestOptions)
  }

  const cached = getCache.get(path)

  if (
    cached
    && Date.now() - cached.timestamp < cacheTtlMs
  ) {
    return Promise.resolve(cached.data)
  }

  if (pendingGets.has(path)) {
    return pendingGets.get(path)
  }

  const request = apiRequest(path, requestOptions)
    .then((data) => {
      getCache.set(path, {
        data,
        timestamp: Date.now(),
      })

      return data
    })
    .finally(() => {
      pendingGets.delete(path)
    })

  pendingGets.set(path, request)

  return request
}

export function clearGetJsonCache(path) {
  if (path) {
    getCache.delete(path)
    pendingGets.delete(path)
    return
  }

  getCache.clear()
  pendingGets.clear()
}

export function postJson(path, body) {
  return apiRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function pairEndpoint(path, drugAId, drugBId) {
  const params = new URLSearchParams({
    drug_a_id: drugAId,
    drug_b_id: drugBId,
  })

  return `${path}?${params.toString()}`
}

export function drugContextEndpoint({
  drugId,
  limit = 50,
  offset = 0,
  relations,
  entityTypes,
}) {
  const params = new URLSearchParams({
    drug_id: drugId,
    limit: String(limit),
    offset: String(offset),
  })

  if (relations?.length) {
    params.set('relations', relations.join(','))
  }

  if (entityTypes?.length) {
    params.set('entity_types', entityTypes.join(','))
  }

  return `/api/context/drug?${params.toString()}`
}

export async function resolveDrug(entityId) {
  if (!entityId) return null

  const data = await getJson(
    `/api/drugs/search?q=${encodeURIComponent(entityId)}&limit=10`,
  )

  return (
    data.results?.find(
      (item) =>
        item.entity_id.toLocaleLowerCase()
        === entityId.toLocaleLowerCase(),
    ) || null
  )
}