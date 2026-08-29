import cytoscape from 'cytoscape'
import { AlertCircle, Focus, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import DrugAutocomplete from '../components/DrugAutocomplete.jsx'
import { getJson, pairEndpoint, resolveDrug } from '../lib/api.js'

const DEFAULT_SHARED_NODES = 15
const MAX_SHARED_NODES = 30

function relationLabel(value) {
  return String(value || '')
    .replaceAll('_', ' ')
}

function selectDisplayedEntities(entities, limit) {
  const geneProtein = entities.filter((entity) => entity.context_group === 'gene/protein')
  const disease = entities.filter((entity) => entity.context_group === 'disease')
  return [...geneProtein, ...disease].slice(0, limit)
}

function makeElements(context, entities) {
  const columns = entities.length > DEFAULT_SHARED_NODES ? 5 : 3
  const horizontalGap = entities.length > DEFAULT_SHARED_NODES ? 150 : 220
  const verticalGap = entities.length > DEFAULT_SHARED_NODES ? 110 : 100
  const firstX = 500 - ((columns - 1) * horizontalGap) / 2
  const rows = Math.max(1, Math.ceil(entities.length / columns))
  const centerY = 80 + ((rows - 1) * verticalGap) / 2
  const elements = [
    {
      data: { id: 'drug-a', label: context.drug_a.drug_name, type: 'drug' },
      position: { x: 20, y: centerY },
    },
    {
      data: { id: 'drug-b', label: context.drug_b.drug_name, type: 'drug' },
      position: { x: 980, y: centerY },
    },
  ]

  entities.forEach((entity, entityIndex) => {
    const nodeId = `context-${entity.context_node_id}`
    elements.push({
      data: {
        id: nodeId,
        label: entity.context_name,
        type: entity.context_group === 'gene/protein' ? 'gene' : 'disease',
      },
      position: {
        x: firstX + (entityIndex % columns) * horizontalGap,
        y: 80 + Math.floor(entityIndex / columns) * verticalGap,
      },
    })
    if (entity.drug_a_relations.length) {
      elements.push({
        data: {
          id: `a-${entity.context_node_id}`,
          source: 'drug-a',
          target: nodeId,
          label: entity.drug_a_relations.map(relationLabel).join(' · '),
        },
      })
    }
    if (entity.drug_b_relations.length) {
      elements.push({
        data: {
          id: `b-${entity.context_node_id}`,
          source: 'drug-b',
          target: nodeId,
          label: entity.drug_b_relations.map(relationLabel).join(' · '),
        },
      })
    }
  })
  return elements
}

function resetGraphFocus(cy) {
  cy.elements().removeClass('faded focused show-label')
  cy.elements().unselect()
}

function relationCounts(drug) {
  const counts = new Map()
  Object.values(drug.context).forEach((group) => {
    group.relationships.forEach((item) => {
      counts.set(item.relation, (counts.get(item.relation) || 0) + 1)
    })
  })
  return [...counts.entries()]
}

export default function GraphExplorer() {
  const [searchParams] = useSearchParams()
  const initialAId = searchParams.get('drug_a_id') || ''
  const initialBId = searchParams.get('drug_b_id') || ''
  const containerRef = useRef(null)
  const cyRef = useRef(null)
  const [drugA, setDrugA] = useState(null)
  const [drugB, setDrugB] = useState(null)
  const [context, setContext] = useState(null)
  const [displayLimit, setDisplayLimit] = useState(DEFAULT_SHARED_NODES)
  const [resolving, setResolving] = useState(Boolean(initialAId || initialBId))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const displayedEntities = useMemo(
    () => selectDisplayedEntities(context?.shared?.entities || [], displayLimit),
    [context, displayLimit],
  )

  useEffect(() => {
    if (!initialAId && !initialBId) return undefined
    let active = true
    Promise.all([resolveDrug(initialAId), resolveDrug(initialBId)])
      .then(([resolvedA, resolvedB]) => {
        if (!active) return
        setDrugA(resolvedA)
        setDrugB(resolvedB)
        if ((initialAId && !resolvedA) || (initialBId && !resolvedB)) {
          setError('One of the requested DrugBank identifiers could not be resolved.')
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'The requested pair could not be resolved.')
      })
      .finally(() => {
        if (active) setResolving(false)
      })
    return () => {
      active = false
    }
  }, [initialAId, initialBId])

  useEffect(() => {
    if (!context || !containerRef.current) return undefined
    const cy = cytoscape({
      container: containerRef.current,
      elements: makeElements(context, displayedEntities),
      wheelSensitivity: 0.2,
      minZoom: 0.35,
      maxZoom: 2.5,
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 10, color: '#344054', 'text-wrap': 'wrap', 'text-max-width': 118, 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 9, 'background-color': '#98a2b3', width: 30, height: 30, 'transition-property': 'opacity, border-width', 'transition-duration': '160ms' } },
        { selector: 'node[type="drug"]', style: { 'background-color': '#6941c6', color: '#ffffff', shape: 'round-rectangle', width: 92, height: 52, 'font-size': 12, 'font-weight': 700, 'text-valign': 'center', 'text-margin-y': 0, 'text-max-width': 82, 'border-width': 3, 'border-color': '#53389e' } },
        { selector: 'node[type="gene"]', style: { 'background-color': '#12b76a', shape: 'ellipse' } },
        { selector: 'node[type="disease"]', style: { 'background-color': '#f79009', shape: 'diamond' } },
        { selector: 'edge', style: { width: 1.5, 'line-color': '#c7ccd4', 'target-arrow-color': '#c7ccd4', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, 'curve-style': 'straight', label: '', 'font-size': 8, color: '#344054', 'text-wrap': 'wrap', 'text-max-width': 180, 'text-background-color': '#ffffff', 'text-background-opacity': 0.95, 'text-background-padding': 3, 'transition-property': 'opacity, width, line-color', 'transition-duration': '160ms' } },
        { selector: 'edge.show-label', style: { label: 'data(label)', width: 2.8, 'line-color': '#6941c6', 'target-arrow-color': '#6941c6', 'z-index': 20 } },
        { selector: '.focused', style: { opacity: 1, 'z-index': 30 } },
        { selector: 'node.focused', style: { 'border-width': 4, 'border-color': '#1570ef' } },
        { selector: 'edge.focused', style: { width: 3, 'line-color': '#1570ef', 'target-arrow-color': '#1570ef' } },
        { selector: '.faded', style: { opacity: 0.12, 'text-opacity': 0.08 } },
      ],
      layout: { name: 'preset', fit: true, padding: 58 },
    })

    cy.on('mouseover', 'edge', (event) => {
      event.target.addClass('show-label')
    })
    cy.on('mouseout', 'edge', (event) => {
      if (!event.target.selected()) event.target.removeClass('show-label')
    })
    cy.on('tap', 'node[type != "drug"]', (event) => {
      resetGraphFocus(cy)
      const node = event.target
      const connectedDrugs = cy.$id('drug-a').union(cy.$id('drug-b'))
      const connectedEdges = connectedDrugs.edgesTo(node)
      cy.elements().addClass('faded')
      node.add(connectedEdges).add(connectedDrugs).removeClass('faded').addClass('focused')
      connectedEdges.addClass('show-label')
      node.select()
    })
    cy.on('tap', 'edge', (event) => {
      resetGraphFocus(cy)
      const edge = event.target
      const endpoints = edge.connectedNodes()
      cy.elements().addClass('faded')
      edge.add(endpoints).removeClass('faded').addClass('focused')
      edge.addClass('show-label').select()
    })
    cy.on('tap', (event) => {
      if (event.target === cy) resetGraphFocus(cy)
    })
    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [context, displayedEntities])

  const pairReady = drugA && drugB && drugA.entity_id !== drugB.entity_id
  const displayedCount = displayedEntities.length
  const displayedRelations = useMemo(() => {
    const relations = new Set()
    displayedEntities.forEach((entity) => {
      entity.drug_a_relations.forEach((relation) => relations.add(relationLabel(relation)))
      entity.drug_b_relations.forEach((relation) => relations.add(relationLabel(relation)))
    })
    return [...relations]
  }, [displayedEntities])
  const countsA = useMemo(() => (context ? relationCounts(context.drug_a) : []), [context])
  const countsB = useMemo(() => (context ? relationCounts(context.drug_b) : []), [context])

  function fitGraph() {
    const cy = cyRef.current
    if (!cy) return
    resetGraphFocus(cy)
    cy.fit(undefined, 58)
  }

  async function loadContext(event) {
    event.preventDefault()
    if (!pairReady) {
      setError('Choose two different drugs from the search results.')
      return
    }
    setLoading(true)
    setError('')
    setContext(null)
    setDisplayLimit(DEFAULT_SHARED_NODES)
    try {
      setContext(await getJson(pairEndpoint('/api/context/pair', drugA.entity_id, drugB.entity_id)))
    } catch (requestError) {
      setError(requestError.message || 'Graph context could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page graph-page">
      <div className="page-heading">
        <span className="eyebrow">Supporting biomedical context</span>
        <h1>Graph Explorer</h1>
        <p>
          Explore shared gene/protein and disease associations available in the
          verified G3 knowledge graph. This context is not a causal explanation
          of a model score and does not establish clinical safety or harm.
        </p>
      </div>

      <form className="pair-form" onSubmit={loadContext}>
        <DrugAutocomplete label="Drug A" selection={drugA} onSelect={(value) => { setDrugA(value); setContext(null); setError('') }} disabled={resolving} />
        <DrugAutocomplete label="Drug B" selection={drugB} onSelect={(value) => { setDrugB(value); setContext(null); setError('') }} disabled={resolving} />
        <button className="primary-button" type="submit" disabled={!pairReady || loading || resolving}>
          {loading || resolving ? <LoaderCircle className="spin" size={18} /> : <Focus size={18} />}
          {loading ? 'Loading context…' : 'Explore pair'}
        </button>
      </form>

      {error && <div className="inline-alert error"><AlertCircle size={20} />{error}</div>}

      {!context && !loading && !error && (
        <div className="empty-feature-state"><Focus size={28} /><div><strong>Choose a drug pair.</strong><p>Shared G3 context will appear as an interactive, limited subgraph.</p></div></div>
      )}

      {context && (
        <>
          <div className="context-metrics">
            <article><span>Shared entities</span><strong>{context.shared.total.toLocaleString()}</strong></article>
            <article><span>Gene / protein</span><strong>{context.shared.gene_protein_count.toLocaleString()}</strong></article>
            <article><span>Disease</span><strong>{context.shared.disease_count.toLocaleString()}</strong></article>
            <article><span>Displayed</span><strong>{displayedCount}</strong><small>{displayLimit === DEFAULT_SHARED_NODES ? 'focused view' : 'expanded view'}</small></article>
          </div>

          <article className="graph-card">
            <div className="graph-toolbar">
              <div><span className="eyebrow">G3 pair subgraph</span><h2>{context.drug_a.drug_name} + {context.drug_b.drug_name}</h2></div>
              <div className="graph-controls" aria-label="Graph controls">
                <button type="button" onClick={() => cyRef.current?.zoom({ level: cyRef.current.zoom() * 1.2, renderedPosition: { x: 360, y: 230 } })} aria-label="Zoom in"><Plus size={17} /></button>
                <button type="button" onClick={() => cyRef.current?.zoom({ level: cyRef.current.zoom() / 1.2, renderedPosition: { x: 360, y: 230 } })} aria-label="Zoom out"><Minus size={17} /></button>
                <button type="button" onClick={fitGraph}><Focus size={16} />Fit</button>
              </div>
            </div>
            <div className="graph-legend"><span><i className="drug-dot" />Drug</span><span><i className="gene-dot" />Gene / protein</span><span><i className="disease-dot" />Disease</span></div>
            <div className="graph-inspection-bar">
              <p>Select a node or edge to inspect its relationships.</p>
              {context.shared.total > DEFAULT_SHARED_NODES && (
                <button type="button" className="secondary-button graph-display-toggle" onClick={() => setDisplayLimit((current) => current === DEFAULT_SHARED_NODES ? MAX_SHARED_NODES : DEFAULT_SHARED_NODES)}>
                  {displayLimit === DEFAULT_SHARED_NODES ? `Show more (up to ${MAX_SHARED_NODES})` : 'Show fewer'}
                </button>
              )}
            </div>
            <div className="displayed-relations" aria-label="Relations in displayed subgraph">
              <strong>Relations in displayed subgraph</strong>
              <div>{displayedRelations.map((relation) => <span key={relation}>{relation}</span>)}</div>
            </div>
            <div ref={containerRef} className={`cytoscape-canvas ${displayLimit > DEFAULT_SHARED_NODES ? 'expanded' : ''}`} role="img" aria-label={`Interactive G3 graph context for ${context.drug_a.drug_name} and ${context.drug_b.drug_name}`} />
            {context.shared.total > displayedCount && <p className="graph-limit-note">Showing {displayedCount} of {context.shared.total.toLocaleString()} shared entities returned by the context endpoint to reduce visual clutter. Omitted entities are not considered less important.</p>}
            {!context.shared.total && <div className="graph-empty-overlay">No direct shared G3 context entities were found for this pair.</div>}
          </article>

          <div className="individual-context-grid">
            {[[context.drug_a, countsA], [context.drug_b, countsB]].map(([drug, counts]) => (
              <article key={drug.drug_id} className="context-detail-card">
                <span>Total G3 context for this drug</span><h3>{drug.drug_name}</h3><strong>{drug.total_context_edges.toLocaleString()} relationships</strong>
                <div className="relation-chip-list">{counts.map(([relation, count]) => <span key={relation}>{relationLabel(relation)} <b>{count.toLocaleString()}</b></span>)}</div>
              </article>
            ))}
          </div>

          <aside className="safety-notice"><AlertCircle size={21} /><div><strong>Interpretation boundary</strong><p>{context.interpretation}</p></div></aside>
        </>
      )}
    </section>
  )
}
