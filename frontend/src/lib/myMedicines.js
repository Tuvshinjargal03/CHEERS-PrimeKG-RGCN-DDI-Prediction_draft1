export function generateUniqueMedicinePairs(medicines) {
  const pairs = []
  for (let first = 0; first < medicines.length; first += 1) {
    for (let second = first + 1; second < medicines.length; second += 1) {
      pairs.push({ drugA: medicines[first], drugB: medicines[second] })
    }
  }
  return pairs
}
