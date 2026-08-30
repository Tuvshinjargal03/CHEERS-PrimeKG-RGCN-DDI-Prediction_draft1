export async function apiRequest(path, options = {}) {
  const { headers: optionHeaders = {}, ...requestOptions } = options
  const response = await fetch(path, {
    ...requestOptions,
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

    const error = new Error(detail || `Request failed with status ${response.status}.`)
    error.status = response.status
    throw error
  }

  return response.json()
}

export function getJson(path) {
  return apiRequest(path)
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

export async function resolveDrug(entityId) {
  if (!entityId) return null
  const data = await getJson(
    `/api/drugs/search?q=${encodeURIComponent(entityId)}&limit=10`,
  )
  return (
    data.results?.find(
      (item) => item.entity_id.toLocaleLowerCase() === entityId.toLocaleLowerCase(),
    ) || null
  )
}
