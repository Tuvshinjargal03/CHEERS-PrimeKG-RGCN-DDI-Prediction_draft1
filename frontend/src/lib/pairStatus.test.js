import { describe, expect, it } from 'vitest'
import { derivePairReviewStatus } from './pairStatus.js'

describe('derivePairReviewStatus', () => {
  it('uses the important state only for explicit structured label mentions', () => {
    const status = derivePairReviewStatus({
      label_evidence: { evidence_found: true, pair_evidence: [{ section: 'drug_interactions' }] },
      literature: { papers: [] },
    })
    expect(status.key).toBe('important')
  })

  it('uses needs-review when literature exists without an explicit label mention', () => {
    const status = derivePairReviewStatus({
      label_evidence: { evidence_found: false, pair_evidence: [] },
      literature: { papers: [{ pmid: '1' }] },
    })
    expect(status.key).toBe('review')
  })

  it('uses the insufficient state for empty or failed retrieval', () => {
    expect(derivePairReviewStatus(null, true).key).toBe('insufficient')
    expect(derivePairReviewStatus({
      label_evidence: { evidence_found: false, pair_evidence: [] },
      literature: { papers: [] },
    }).key).toBe('insufficient')
  })
})
