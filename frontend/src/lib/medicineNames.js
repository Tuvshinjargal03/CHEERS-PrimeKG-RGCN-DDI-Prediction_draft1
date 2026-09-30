const VERIFIED_MEDICINE_DISPLAY_NAMES = Object.freeze({
  'acetylsalicylic acid': 'Aspirin',
})

export function medicineDisplayName(medicineOrName) {
  const name = typeof medicineOrName === 'string'
    ? medicineOrName
    : medicineOrName?.display_name || medicineOrName?.drug_name || medicineOrName?.name

  if (!name) return ''
  return VERIFIED_MEDICINE_DISPLAY_NAMES[name.trim().toLocaleLowerCase()] || name
}

