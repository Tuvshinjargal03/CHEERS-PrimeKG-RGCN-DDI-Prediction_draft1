export const PAIR_REVIEW_STATUSES = Object.freeze({
  important: {
    key: 'important',
    title: 'Interaction warning found',
    description: 'We found interaction-related information for these medicines in official drug-label sources.',
  },
  review: {
    key: 'review',
    title: 'Needs review',
    description: 'Related literature was retrieved, but CHEERS cannot responsibly turn it into a clinical interpretation.',
  },
  insufficient: {
    key: 'insufficient',
    title: 'Not enough information',
    description: 'The checked sources did not provide enough structured information for a clearer status.',
  },
})

export function derivePairReviewStatus(evidence, requestFailed = false) {
  if (requestFailed || !evidence) return PAIR_REVIEW_STATUSES.insufficient

  const explicitMentions = evidence.label_evidence?.pair_evidence
  if (evidence.label_evidence?.evidence_found && explicitMentions?.length) {
    return PAIR_REVIEW_STATUSES.important
  }

  if (evidence.literature?.papers?.length) {
    return PAIR_REVIEW_STATUSES.review
  }

  return PAIR_REVIEW_STATUSES.insufficient
}
