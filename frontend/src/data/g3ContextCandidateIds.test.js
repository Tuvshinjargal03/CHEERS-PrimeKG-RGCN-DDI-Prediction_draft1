import { describe, expect, it } from 'vitest'
import { G3_CONTEXT_CANDIDATE_IDS } from './g3ContextCandidateIds.js'

describe('G3 context candidate availability index', () => {
  it('contains the frozen supported-candidate intersection without duplicates', () => {
    expect(G3_CONTEXT_CANDIDATE_IDS).toHaveLength(2974)
    expect(new Set(G3_CONTEXT_CANDIDATE_IDS)).toHaveProperty('size', 2974)
    expect(G3_CONTEXT_CANDIDATE_IDS).toEqual([...G3_CONTEXT_CANDIDATE_IDS].sort())
  })

  it('matches the verified representative availability cases', () => {
    expect(G3_CONTEXT_CANDIDATE_IDS).toContain('DB00682')
    expect(G3_CONTEXT_CANDIDATE_IDS).toContain('DB00945')
    expect(G3_CONTEXT_CANDIDATE_IDS).not.toContain('DB14093')
  })
})
