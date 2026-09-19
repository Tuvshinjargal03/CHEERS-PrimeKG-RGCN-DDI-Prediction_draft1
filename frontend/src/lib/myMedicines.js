export const SAVED_MEDICINES_STORAGE_KEY = 'cheers.my-medicines.v1'
export const REVIEW_MEDICINES_STORAGE_KEY = 'cheers.my-medicines-review.v1'
export const MAX_SAVED_MEDICINES = 20
export const MAX_REVIEW_MEDICINES = 8

export function reconcileReviewMedicineIds(savedMedicines, storedReviewMedicineIds) {
  const savedIds = []
  const savedIdSet = new Set()

  if (Array.isArray(savedMedicines)) {
    for (const medicine of savedMedicines) {
      const id = typeof medicine?.entity_id === 'string' ? medicine.entity_id.trim() : ''
      if (!id || savedIdSet.has(id)) continue
      savedIdSet.add(id)
      savedIds.push(id)
    }
  }

  if (!Array.isArray(storedReviewMedicineIds)) {
    return savedIds.slice(0, MAX_REVIEW_MEDICINES)
  }

  const selectedIds = new Set()
  for (const storedId of storedReviewMedicineIds) {
    if (selectedIds.size >= MAX_REVIEW_MEDICINES) break
    const id = typeof storedId === 'string' ? storedId.trim() : ''
    if (!id || !savedIdSet.has(id)) continue
    selectedIds.add(id)
  }

  return savedIds.filter((id) => selectedIds.has(id))
}

export function generateUniqueMedicinePairs(medicines) {
  const pairs = []
  for (let first = 0; first < medicines.length; first += 1) {
    for (let second = first + 1; second < medicines.length; second += 1) {
      pairs.push({ drugA: medicines[first], drugB: medicines[second] })
    }
  }
  return pairs
}
