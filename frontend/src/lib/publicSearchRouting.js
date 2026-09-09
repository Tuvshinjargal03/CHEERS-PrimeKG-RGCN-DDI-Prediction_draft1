export function publicSearchDestination(payload) {
  const entities = payload?.recognized_entities || []
  const first = entities[0]

  if (payload?.ambiguous_matches?.length || !first) return null

  if (payload.intent === 'disease_information' && first.entity_type === 'disease') {
    return `/diseases/${encodeURIComponent(first.entity_id)}`
  }

  if (first.entity_type === 'drug') {
    if (payload.intent === 'drug_information') {
      return `/medicines/${encodeURIComponent(first.entity_id)}`
    }
    if (payload.intent === 'drug_side_effects') {
      return `/medicines/${encodeURIComponent(first.entity_id)}?section=side-effects`
    }
    if (payload.intent === 'drug_interactions') {
      return `/medicines/${encodeURIComponent(first.entity_id)}?section=interactions`
    }
  }

  if (
    payload.intent === 'drug_pair'
    && entities.length === 2
    && entities.every((entity) => entity.entity_type === 'drug')
  ) {
    const params = new URLSearchParams({
      drug_a_id: entities[0].entity_id,
      drug_b_id: entities[1].entity_id,
    })
    return `/check?${params.toString()}`
  }

  return null
}
