import { describe, expect, it } from 'vitest'
import { publicSearchDestination } from './publicSearchRouting.js'

const DRUG = { entity_type: 'drug', entity_id: 'DB00331', name: 'Metformin' }
const DRUG_B = { entity_type: 'drug', entity_id: 'DB00682', name: 'Warfarin' }
const DISEASE = { entity_type: 'disease', entity_id: '5148', name: 'type 2 diabetes mellitus' }

describe('publicSearchDestination', () => {
  it('routes disease information to a disease profile', () => {
    expect(publicSearchDestination({ intent: 'disease_information', recognized_entities: [DISEASE] })).toBe('/diseases/5148')
  })

  it('routes a single medicine to its profile', () => {
    expect(publicSearchDestination({ intent: 'drug_information', recognized_entities: [DRUG] })).toBe('/medicines/DB00331')
  })

  it('focuses side-effect and interaction sections from backend intent', () => {
    expect(publicSearchDestination({ intent: 'drug_side_effects', recognized_entities: [DRUG] })).toBe('/medicines/DB00331?section=side-effects')
    expect(publicSearchDestination({ intent: 'drug_interactions', recognized_entities: [DRUG] })).toBe('/medicines/DB00331?section=interactions')
  })

  it('routes two recognized drugs to the public checker', () => {
    expect(publicSearchDestination({ intent: 'drug_pair', recognized_entities: [DRUG_B, DRUG] })).toBe('/check?drug_a_id=DB00682&drug_b_id=DB00331')
  })

  it('does not route ambiguous, unknown, or unsupported results', () => {
    expect(publicSearchDestination({ intent: 'disease_information', recognized_entities: [], ambiguous_matches: [{}] })).toBeNull()
    expect(publicSearchDestination({ intent: 'unknown', recognized_entities: [] })).toBeNull()
    expect(publicSearchDestination({ intent: 'unsupported', recognized_entities: [DRUG] })).toBeNull()
  })
})
