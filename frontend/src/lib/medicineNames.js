const VERIFIED_MEDICINE_DISPLAY_NAMES = Object.freeze({
  'acetylsalicylic acid': 'Aspirin',
})

export const VERIFIED_MEDICINE_STARTERS = Object.freeze([
  Object.freeze({ name: 'Metformin', entity_id: 'DB00331', node_id: 5371 }),
  Object.freeze({ name: 'Acetylsalicylic acid', entity_id: 'DB00945', node_id: 4564 }),
  Object.freeze({ name: 'Warfarin', entity_id: 'DB00682', node_id: 2999 }),
  Object.freeze({ name: 'Ibuprofen', entity_id: 'DB01050', node_id: 3070 }),
])

export function medicineDisplayName(medicineOrName) {
  const name = typeof medicineOrName === 'string'
    ? medicineOrName
    : medicineOrName?.display_name || medicineOrName?.drug_name || medicineOrName?.name

  if (!name) return ''
  return VERIFIED_MEDICINE_DISPLAY_NAMES[name.trim().toLocaleLowerCase()] || name
}

