import cytoscape from 'cytoscape'
import { AlertCircle, Focus, LoaderCircle, Minus, Plus, Share2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import { drugContextEndpoint, getJson } from '../lib/api.js'

const PAGE_SIZE = 50
const RELATIONS = [
  ['drug_drug', 'DDI'],
  ['target', 'Target'],
  ['enzyme', 'Enzyme'],
  ['carrier', 'Carrier'],
  ['transporter', 'Transporter'],
  ['indication', 'Indication'],
  ['contraindication', 'Contraindication'],
  ['off-label use', 'Off-label use'],
]
const ENTITY_TYPES = [
  ['drug', 'Drugs'],
  ['gene/protein', 'Gene / Protein'],
  ['disease', 'Diseases'],
]
const ALL_RELATIONS = RELATIONS.map(([value]) => value)
const ALL_ENTITY_TYPES = ENTITY_TYPES.map(([value]) => value)

function edgeId(centerNodeId, relation, neighborNodeId) {
  const safeRelation = relation.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `edge-${centerNodeId}-${safeRelation}-${neighborNodeId}`
}

function makeElements(center, neighbors) {
  const elements = [{
    data: {
      id: `node-${center.node_id}`,
      label: center.name,
      type: 'drug',
      isCenter: 1,
      entity: center,
    },
  }]

  neighbors.forEach((neighbor) => {
    const nodeId = `node-${neighbor.node_id}`
    elements.push({
      data: {
        id: nodeId,
        label: neighbor.name,
        type: neighbor.entity_type,
        isCenter: 0,
        entity: neighbor,
      },
    })
    neighbor.relationships.forEach((relationship) => {
      elements.push({
        data: {
          id: edgeId(center.node_id, relationship.relation, neighbor.node_id),
          source: `node-${center.node_id}`,
          target: nodeId,
          label: relationship.display_relation,
          relation: relationship.relation,
          displayRelation: relationship.display_relation,
          center,
          neighbor,
        },
      })
    })
  })
  return elements
}

function resetGraphFocus(cy) {
  cy.elements().removeClass('faded focused show-label')
  cy.elements().unselect()
}

function emptyFilteredData(previous, relations, entityTypes) {
  return {
    ...previous,
    neighbors: [],
    counts: {
      total_neighbors: 0,
      total_relationships: 0,
      by_entity_type: Object.fromEntries(ENTITY_TYPES.map(([value]) => [value, 0])),
      by_relation: Object.fromEntries(RELATIONS.map(([value]) => [value, 0])),
    },
    pagination: {
      offset: 0,
      limit: PAGE_SIZE,
      returned_neighbors: 0,
      returned_relationships: 0,
      has_more: false,
      next_offset: null,
    },
    filters: { relations, entity_types: entityTypes },
  }
}

function ElementDetails({ selected, center }) {
  if (!selected) {
    return <div className="subgraph-detail-empty"><Focus size={24} /><p>Select a node or edge to inspect its graph metadata.</p></div>
  }
  if (selected.kind === 'node') {
    const entity = selected.data.entity
    const isCenter = Boolean(selected.data.isCenter)
    return (
      <div className="subgraph-detail-content">
        <span className="card-kicker">{isCenter ? 'Center node' : 'Neighbor node'}</span>
        <h3>{entity.name}</h3>
        <dl>
          <div><dt>Entity type</dt><dd>{entity.entity_type === 'gene/protein' ? 'Gene / Protein' : entity.entity_type[0].toUpperCase() + entity.entity_type.slice(1)}</dd></div>
          <div><dt>Entity ID</dt><dd>{entity.entity_id}</dd></div>
          <div><dt>Graph node ID</dt><dd>{entity.node_id}</dd></div>
          <div><dt>Source</dt><dd>{entity.source}</dd></div>
          {isCenter && <div><dt>Role</dt><dd>Center drug</dd></div>}
        </dl>
        {!isCenter && (
          <div className="detail-relations">
            <strong>Relations to {center.name}</strong>
            <div>{entity.relationships.map((edge) => <span key={edge.relation}>{edge.display_relation}</span>)}</div>
          </div>
        )}
      </div>
    )
  }

  const { center: source, neighbor, displayRelation, relation } = selected.data
  return (
    <div className="subgraph-detail-content">
      <span className="card-kicker">Graph relationship</span>
      <h3>{displayRelation}</h3>
      <dl>
        <div><dt>Source</dt><dd>{source.name}</dd></div>
        <div><dt>Relation</dt><dd>{displayRelation} <small>{relation}</small></dd></div>
        <div><dt>Target</dt><dd>{neighbor.name}</dd></div>
        <div><dt>Status</dt><dd>Known G3 graph relationship</dd></div>
        <div><dt>{relation === 'drug_drug' ? 'DDI scope' : 'Context scope'}</dt><dd>{relation === 'drug_drug' ? 'Training-only G3 relationship' : 'G3 forward support relationship'}</dd></div>
        <div><dt>Predicted</dt><dd>No</dd></div>
      </dl>
    </div>
  )
}

export default function SubgraphExplorer() {
  const containerRef = useRef(null)
  const cyRef = useRef(null)
  const requestId = useRef(0)
  const [drug, setDrug] = useState(null)
  const [exploredDrug, setExploredDrug] = useState(null)
  const [data, setData] = useState(null)
  const [neighbors, setNeighbors] = useState([])
  const [enabledRelations, setEnabledRelations] = useState(ALL_RELATIONS)
  const [enabledEntityTypes, setEnabledEntityTypes] = useState(ALL_ENTITY_TYPES)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError] = useState('')

  const elements = useMemo(
    () => data ? makeElements(data.center, neighbors) : [],
    [data, neighbors],
  )

  useEffect(() => {
    if (!data || !containerRef.current) return undefined
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 2.5,
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 9, color: '#344054', 'text-wrap': 'wrap', 'text-max-width': 105, 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 8, 'background-color': '#98a2b3', width: 29, height: 29, 'transition-property': 'opacity, border-width', 'transition-duration': '160ms' } },
        { selector: 'node[type="drug"]', style: { 'background-color': '#8b5cf6', shape: 'round-rectangle', width: 54, height: 34, 'font-size': 9, 'text-max-width': 49, 'text-valign': 'center', 'text-margin-y': 0, color: '#ffffff', 'border-width': 2, 'border-color': '#6941c6' } },
        { selector: 'node[isCenter = 1]', style: { 'background-color': '#6941c6', width: 112, height: 62, 'font-size': 13, 'font-weight': 700, 'text-max-width': 98, 'border-width': 5, 'border-color': '#42307d', 'z-index': 40 } },
        { selector: 'node[type="gene/protein"]', style: { 'background-color': '#12b76a', shape: 'ellipse' } },
        { selector: 'node[type="disease"]', style: { 'background-color': '#f79009', shape: 'diamond' } },
        { selector: 'edge', style: { width: 1.35, 'line-color': '#c7ccd4', 'target-arrow-color': '#c7ccd4', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.65, 'curve-style': 'bezier', label: '', 'font-size': 8, color: '#344054', 'text-background-color': '#ffffff', 'text-background-opacity': 0.96, 'text-background-padding': 3, 'transition-property': 'opacity, width, line-color', 'transition-duration': '160ms' } },
        { selector: 'edge.show-label', style: { label: 'data(label)', width: 2.6, 'line-color': '#6941c6', 'target-arrow-color': '#6941c6', 'z-index': 25 } },
        { selector: '.focused', style: { opacity: 1, 'z-index': 30 } },
        { selector: 'node.focused', style: { 'border-width': 4, 'border-color': '#1570ef' } },
        { selector: 'edge.focused', style: { width: 3, 'line-color': '#1570ef', 'target-arrow-color': '#1570ef' } },
        { selector: '.faded', style: { opacity: 0.1, 'text-opacity': 0.06 } },
      ],
      layout: {
        name: 'concentric',
        concentric: (node) => node.data('isCenter') ? 2 : 1,
        levelWidth: () => 1,
        minNodeSpacing: 34,
        startAngle: -Math.PI / 2,
        clockwise: true,
        equidistant: true,
        animate: false,
        fit: true,
        padding: 56,
      },
    })

    cy.on('mouseover', 'edge', (event) => event.target.addClass('show-label'))
    cy.on('mouseout', 'edge', (event) => {
      if (!event.target.selected()) event.target.removeClass('show-label')
    })
    cy.on('tap', 'node', (event) => {
      resetGraphFocus(cy)
      const node = event.target
      const center = cy.$id(`node-${data.center.node_id}`)
      const connecting = node.data('isCenter') ? center.connectedEdges() : center.edgesTo(node)
      cy.elements().addClass('faded')
      node.add(center).add(connecting).removeClass('faded').addClass('focused')
      connecting.addClass('show-label')
      node.select()
      setSelected({ kind: 'node', data: node.data() })
    })
    cy.on('tap', 'edge', (event) => {
      resetGraphFocus(cy)
      const edge = event.target
      cy.elements().addClass('faded')
      edge.add(edge.connectedNodes()).removeClass('faded').addClass('focused')
      edge.addClass('show-label').select()
      setSelected({ kind: 'edge', data: edge.data() })
    })
    cy.on('tap', (event) => {
      if (event.target === cy) {
        resetGraphFocus(cy)
        setSelected(null)
      }
    })
    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [data, elements])

  async function requestNeighborhood({
    targetDrug,
    relations = enabledRelations,
    entityTypes = enabledEntityTypes,
    offset = 0,
    pageChange = false,
  }) {
    if (!relations.length || !entityTypes.length) {
      requestId.current += 1
      setData((current) => current ? emptyFilteredData(current, relations, entityTypes) : current)
      setNeighbors([])
      setSelected(null)
      setLoading(false)
      setPageLoading(false)
      setError('')
      return
    }
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    pageChange ? setPageLoading(true) : setLoading(true)
    if (pageChange) setSelected(null)
    setError('')
    try {
      const payload = await getJson(drugContextEndpoint({
        drugId: targetDrug.entity_id,
        limit: PAGE_SIZE,
        offset,
        relations,
        entityTypes,
      }))
      if (requestId.current !== currentRequest) return
      if (payload.neighbors.length > PAGE_SIZE) {
        throw new Error(`Neighborhood page exceeded the ${PAGE_SIZE}-node display limit.`)
      }
      setData(payload)
      setNeighbors(payload.neighbors)
      setSelected(null)
    } catch (requestError) {
      if (requestId.current === currentRequest) setError(requestError.message || 'Subgraph context could not be loaded.')
    } finally {
      if (requestId.current === currentRequest) {
        setLoading(false)
        setPageLoading(false)
      }
    }
  }

  function explore(event) {
    event.preventDefault()
    if (!drug) return
    setExploredDrug(drug)
    setData(null)
    setNeighbors([])
    requestNeighborhood({ targetDrug: drug })
  }

  function toggleFilter(group, value) {
    const current = group === 'relation' ? enabledRelations : enabledEntityTypes
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
    if (group === 'relation') setEnabledRelations(next)
    else setEnabledEntityTypes(next)
    if (exploredDrug) requestNeighborhood({
      targetDrug: exploredDrug,
      relations: group === 'relation' ? next : enabledRelations,
      entityTypes: group === 'entity' ? next : enabledEntityTypes,
    })
  }

  function changePage(offset) {
    if (pageLoading || offset < 0) return
    requestNeighborhood({
      targetDrug: exploredDrug,
      offset,
      pageChange: true,
    })
  }

  function fitGraph() {
    if (!cyRef.current) return
    resetGraphFocus(cyRef.current)
    setSelected(null)
    cyRef.current.fit(undefined, 56)
  }

  const pageOffset = data?.pagination?.offset || 0
  const totalNeighbors = data?.counts?.total_neighbors || 0
  const rangeStart = neighbors.length ? pageOffset + 1 : 0
  const rangeEnd = pageOffset + neighbors.length
  const currentPage = totalNeighbors ? Math.floor(pageOffset / PAGE_SIZE) + 1 : 0
  const totalPages = totalNeighbors ? Math.ceil(totalNeighbors / PAGE_SIZE) : 0

  return (
    <section className="page subgraph-page">
      <div className="page-heading">
        <span className="eyebrow">Single-drug G3 context</span>
        <h1>Subgraph Explorer</h1>
        <p>Explore the 1-hop biomedical neighborhood available in the G3 graph.</p>
      </div>

      <aside className="subgraph-scope-note"><AlertCircle size={20} /><p><strong>Research context</strong>This view shows relationships available in the G3 graph. Drug–drug edges are training-only G3 relationships. The graph is descriptive context, not a causal model explanation or clinical safety assessment.</p></aside>

      <form className="subgraph-search-form" onSubmit={explore}>
        <DrugAutocomplete label="Center drug" selection={drug} onSelect={(value) => { setDrug(value); setError('') }} />
        <button type="submit" className="primary-button" disabled={!drug || loading}>
          {loading ? <LoaderCircle className="spin" size={18} /> : <Share2 size={18} />}
          {loading ? 'Fetching graph context…' : 'Explore subgraph'}
        </button>
      </form>

      {error && <div className="inline-alert error"><AlertCircle size={20} />{error}</div>}
      {!data && !loading && !error && <div className="empty-feature-state"><Share2 size={28} /><div><strong>No drug explored yet.</strong><p>Select one candidate drug to load its training-safe, 1-hop G3 neighborhood.</p></div></div>}
      {loading && <div className="experiment-state"><LoaderCircle className="spin" size={27} />Fetching graph context…</div>}

      {data && !loading && (
        <>
          <div className="subgraph-metrics">
            <article><span>Total neighbors</span><strong>{data.counts.total_neighbors.toLocaleString()}</strong></article>
            <article><span>Relationships</span><strong>{data.counts.total_relationships.toLocaleString()}</strong></article>
            <article><span>Drug neighbors</span><strong>{data.counts.by_entity_type.drug.toLocaleString()}</strong></article>
            <article><span>Gene / protein</span><strong>{data.counts.by_entity_type['gene/protein'].toLocaleString()}</strong></article>
            <article><span>Disease</span><strong>{data.counts.by_entity_type.disease.toLocaleString()}</strong></article>
            <article><span>Displayed</span><strong>{neighbors.length.toLocaleString()}</strong><small>unique neighbors</small></article>
          </div>

          <section className="subgraph-filter-card" aria-label="Subgraph filters">
            <div className="filter-heading"><div><span className="eyebrow">Backend filters</span><h2>Visible relationships</h2></div><p>Filters reset the graph and are applied before pagination.</p></div>
            <fieldset><legend>Relations</legend><div className="filter-chip-grid">{RELATIONS.map(([value, label]) => <label key={value} className={enabledRelations.includes(value) ? 'checked' : ''}><input type="checkbox" checked={enabledRelations.includes(value)} onChange={() => toggleFilter('relation', value)} /><span>{label}</span><b>{data.counts.by_relation[value].toLocaleString()}</b></label>)}</div></fieldset>
            <fieldset><legend>Entity types</legend><div className="filter-chip-grid entity-filters">{ENTITY_TYPES.map(([value, label]) => <label key={value} className={enabledEntityTypes.includes(value) ? 'checked' : ''}><input type="checkbox" checked={enabledEntityTypes.includes(value)} onChange={() => toggleFilter('entity', value)} /><span>{label}</span><b>{data.counts.by_entity_type[value].toLocaleString()}</b></label>)}</div></fieldset>
          </section>

          {!neighbors.length ? (
            <div className="empty-feature-state"><Focus size={28} /><div><strong>No neighbors match the current filters.</strong><p>Enable at least one relation and entity type, or broaden the selected filters.</p></div></div>
          ) : (
            <div className="subgraph-workspace">
              <article className="graph-card subgraph-graph-card">
                <div className="graph-toolbar"><div><span className="eyebrow">One-hop G3 neighborhood</span><h2>{data.center.name}</h2></div><div className="graph-controls" aria-label="Graph controls"><button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => cyRef.current?.zoom({ level: cyRef.current.zoom() * 1.2, renderedPosition: { x: 360, y: 260 } })}><Plus size={17} /></button><button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => cyRef.current?.zoom({ level: cyRef.current.zoom() / 1.2, renderedPosition: { x: 360, y: 260 } })}><Minus size={17} /></button><button type="button" title="Fit graph" onClick={fitGraph}><Focus size={16} />Fit</button></div></div>
                <div className="graph-legend subgraph-legend"><span><i className="center-dot" />Center drug</span><span><i className="drug-dot" />Drug</span><span><i className="gene-dot" />Gene / protein</span><span><i className="disease-dot" />Disease</span></div>
                <div ref={containerRef} className="cytoscape-canvas subgraph-canvas" role="img" aria-label={`Interactive one-hop G3 neighborhood for ${data.center.name}`} />
                <div className="subgraph-pagination">
                  <p>
                    Showing neighbors <strong>{rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}</strong> of <strong>{totalNeighbors.toLocaleString()}</strong>
                    {totalPages > 0 && <small>Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()}</small>}
                  </p>
                  <div className="subgraph-page-buttons">
                    {pageOffset > 0 && <button type="button" className="secondary-button" disabled={pageLoading} onClick={() => changePage(Math.max(0, pageOffset - PAGE_SIZE))}>Previous {PAGE_SIZE}</button>}
                    {data.pagination.has_more && <button type="button" className="secondary-button" disabled={pageLoading} onClick={() => changePage(data.pagination.next_offset)}>{pageLoading ? <LoaderCircle className="spin" size={15} /> : null}{pageLoading ? 'Loading…' : `Next ${PAGE_SIZE}`}</button>}
                  </div>
                </div>
              </article>
              <aside className="subgraph-details-card" aria-live="polite"><ElementDetails selected={selected} center={data.center} /></aside>
            </div>
          )}

          <div className="subgraph-relation-summary"><strong>Filtered relationship counts</strong><div>{RELATIONS.filter(([value]) => data.counts.by_relation[value] > 0).map(([value, label]) => <span key={value}>{label} <b>{data.counts.by_relation[value].toLocaleString()}</b></span>)}</div></div>
          <aside className="safety-notice"><AlertCircle size={21} /><div><strong>Interpretation boundary</strong><p>{data.interpretation}</p></div></aside>
        </>
      )}
    </section>
  )
}
