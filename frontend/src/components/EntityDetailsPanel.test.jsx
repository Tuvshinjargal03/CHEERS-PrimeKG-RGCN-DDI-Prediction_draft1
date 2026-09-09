import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EntityDetailsPanel from './EntityDetailsPanel.jsx'

const WARFARIN = { node_id: 1, entity_id: 'DB00682', name: 'Warfarin', entity_type: 'drug', source: 'DrugBank' }
const ACARBOSE = { node_id: 2, entity_id: 'DB00284', name: 'Acarbose', entity_type: 'drug', source: 'DrugBank' }

function nodeSelection(entity, options = {}) {
  return { kind: 'node', data: { id: `node-${entity.node_id}`, entity, isCenter: options.isCenter ? 1 : 0, relationshipPaths: options.relationshipPaths } }
}

describe('EntityDetailsPanel', () => {
  it('shows enriched center-drug information', () => {
    const drug = { ...WARFARIN, metadata: { drug_information: { general_use: 'Anticoagulant use.', sources: ['DrugBank'] } } }
    render(<EntityDetailsPanel selected={nodeSelection(drug, { isCenter: true })} center={drug} />)

    expect(screen.getByText('Center node')).toBeVisible()
    expect(screen.getByText('Anticoagulant use.')).toBeVisible()
    expect(screen.getByText('DB00682')).toBeVisible()
  })

  it('shows pair relationship paths and gene metadata', () => {
    const gene = {
      node_id: 3,
      entity_id: '1576',
      name: 'CYP3A4',
      entity_type: 'gene/protein',
      source: 'NCBI',
      relationships: [{ relation: 'enzyme', display_relation: 'Enzyme' }],
      metadata: { matched: true, official_symbol: 'CYP3A4', aliases: ['CP33'], summary: 'Gene summary.' },
    }
    const paths = [WARFARIN, ACARBOSE].map((center) => ({ center, relationships: gene.relationships }))
    render(<EntityDetailsPanel selected={nodeSelection(gene, { relationshipPaths: paths })} center={WARFARIN} />)

    expect(screen.getByText('Neighbor node')).toBeVisible()
    expect(screen.getByText('Current NCBI symbol')).toBeVisible()
    expect(screen.getByText('CP33')).toBeVisible()
    expect(screen.getAllByText('CYP3A4').length).toBeGreaterThan(1)
    expect(screen.getByText('Warfarin · Enzyme')).toBeVisible()
    expect(screen.getByText('Acarbose · Enzyme')).toBeVisible()
  })

  it('updates the existing panel when selection changes to a disease', () => {
    const gene = { node_id: 3, entity_id: '1576', name: 'CYP3A4', entity_type: 'gene/protein', source: 'NCBI', relationships: [] }
    const disease = {
      node_id: 4,
      entity_id: 'MONDO:0005015',
      name: 'gallbladder disease',
      entity_type: 'disease',
      source: 'MONDO',
      relationships: [{ relation: 'indication', display_relation: 'indication' }],
      metadata: { description: 'A disease of the gallbladder.', source: 'MONDO', source_id: 'MONDO:0005015', license: 'CC BY 4.0' },
    }
    const { rerender } = render(<EntityDetailsPanel selected={nodeSelection(gene)} center={WARFARIN} />)
    rerender(<EntityDetailsPanel selected={nodeSelection(disease)} center={WARFARIN} />)

    expect(screen.queryByRole('heading', { name: 'CYP3A4' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'gallbladder disease' })).toBeVisible()
    expect(screen.getByText('A disease of the gallbladder.')).toBeVisible()
  })
})
