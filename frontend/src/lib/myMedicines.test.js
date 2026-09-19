import { describe, expect, it } from 'vitest'
import {
  generateUniqueMedicinePairs,
  MAX_REVIEW_MEDICINES,
  MAX_SAVED_MEDICINES,
  reconcileReviewMedicineIds,
  REVIEW_MEDICINES_STORAGE_KEY,
  SAVED_MEDICINES_STORAGE_KEY,
} from './myMedicines.js'

function medicines(count) {
  return Array.from({ length: count }, (_, index) => ({
    entity_id: `DB${String(index + 1).padStart(5, '0')}`,
    name: `Medicine ${index + 1}`,
  }))
}

describe('medicine selection model', () => {
  it('exports the saved and review limits with stable storage keys', () => {
    expect(MAX_SAVED_MEDICINES).toBe(20)
    expect(MAX_REVIEW_MEDICINES).toBe(8)
    expect(SAVED_MEDICINES_STORAGE_KEY).toBe('cheers.my-medicines.v1')
    expect(REVIEW_MEDICINES_STORAGE_KEY).toBe('cheers.my-medicines-review.v1')
  })

  it('defaults missing or non-array selection to the first eight saved medicines', () => {
    const saved = medicines(10)
    const expected = saved.slice(0, 8).map((medicine) => medicine.entity_id)

    expect(reconcileReviewMedicineIds(saved, undefined)).toEqual(expected)
    expect(reconcileReviewMedicineIds(saved, null)).toEqual(expected)
    expect(reconcileReviewMedicineIds(saved, 'not-an-array')).toEqual(expected)
  })

  it('selects every legacy saved medicine when there are no more than eight', () => {
    const saved = medicines(5)

    expect(reconcileReviewMedicineIds(saved, undefined)).toEqual(
      saved.map((medicine) => medicine.entity_id),
    )
  })

  it('preserves an explicit empty selection', () => {
    expect(reconcileReviewMedicineIds(medicines(3), [])).toEqual([])
  })

  it('keeps only the first eight valid stored selections, then returns saved-medicine order', () => {
    const saved = medicines(10)
    const stored = saved.toReversed().map((medicine) => medicine.entity_id)

    expect(reconcileReviewMedicineIds(saved, stored)).toEqual(
      saved.slice(2).map((medicine) => medicine.entity_id),
    )
  })

  it('ignores duplicates, unknown IDs, blanks, non-strings, and removed medicines', () => {
    const [first, second, third] = medicines(3)
    const savedAfterRemoval = [third, first]
    const stored = [first.entity_id, 'UNKNOWN', second.entity_id, '', null, first.entity_id, third.entity_id]

    expect(reconcileReviewMedicineIds(savedAfterRemoval, stored)).toEqual([
      third.entity_id,
      first.entity_id,
    ])
  })

  it('does not throw for invalid saved or stored input', () => {
    expect(() => reconcileReviewMedicineIds(null, { invalid: true })).not.toThrow()
    expect(reconcileReviewMedicineIds([null, {}, { entity_id: 7 }], [null, 7, {}])).toEqual([])
  })

  it('keeps unique pair generation unchanged', () => {
    const saved = medicines(3)

    expect(generateUniqueMedicinePairs(saved)).toEqual([
      { drugA: saved[0], drugB: saved[1] },
      { drugA: saved[0], drugB: saved[2] },
      { drugA: saved[1], drugB: saved[2] },
    ])
  })
})
