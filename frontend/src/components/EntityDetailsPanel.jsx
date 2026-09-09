import { Focus } from 'lucide-react'
import { useState } from 'react'

const ENTITY_TYPE_DETAILS = {
  drug: { label: 'Drug', idLabel: 'DrugBank ID', summary: "A DrugBank-linked drug node in the model's candidate set." },
  'gene/protein': { label: 'Gene / Protein', idLabel: 'NCBI ID', summary: 'A gene/protein context node identified by an NCBI ID in the G3 graph.' },
  disease: { label: 'Disease', idLabel: 'Context ID', summary: 'A disease context node identified from MONDO or MONDO_grouped in the G3 graph.' },
}

const RELATION_EXPLANATIONS = {
  drug_drug: { text: 'The training portion of the G3 graph records a PrimeKG drug–drug relationship between the selected drug and this drug.', note: 'This is graph context, not an interaction severity or safety assessment.' },
  target: { text: 'The G3 graph records this gene/protein through a target relationship with the selected drug.' },
  enzyme: { text: 'The G3 graph records this gene/protein through an enzyme relationship with the selected drug.' },
  carrier: { text: 'The G3 graph records this gene/protein through a carrier relationship with the selected drug.' },
  transporter: { text: 'The G3 graph records this gene/protein through a transporter relationship with the selected drug.' },
  indication: { text: 'The G3 graph records this disease through an indication relationship with the selected drug.' },
  contraindication: { text: 'The G3 graph records this disease through a contraindication relationship with the selected drug.' },
  'off-label use': { text: 'The G3 graph records this disease through an off-label-use relationship with the selected drug.' },
}

function displaySubstance(value, entityName) {
  if (value === value.toUpperCase() && entityName !== entityName.toUpperCase()
    && value.toLowerCase() === entityName.toLowerCase()) return entityName
  return value
}

export default function EntityDetailsPanel({ selected, center }) {
  const [showAllAliases, setShowAllAliases] = useState(false)
  const [showFullSummary, setShowFullSummary] = useState(false)

  if (!selected) {
    return <div className="subgraph-detail-empty"><Focus size={24} /><p>Select a node or edge to inspect its graph metadata.</p></div>
  }
  if (selected.kind === 'node') {
    const entity = selected.data.entity
    const isCenter = Boolean(selected.data.isCenter)
    const typeDetails = ENTITY_TYPE_DETAILS[entity.entity_type]
    const relationshipPaths = selected.data.relationshipPaths
      || (!isCenter ? [{ center, relationships: entity.relationships }] : [])
    const metadata = entity.entity_type === 'gene/protein' && entity.metadata?.matched === true
      ? entity.metadata
      : null
    const aliases = metadata?.aliases || []
    const visibleAliases = showAllAliases ? aliases : aliases.slice(0, 5)
    const summaryCanExpand = Boolean(metadata?.summary && metadata.summary.length > 360)
    return (
      <div className="subgraph-detail-content">
        <span className="card-kicker">{isCenter ? 'Center node' : 'Neighbor node'}</span>
        <h3>{entity.name}</h3>
        <span className="entity-type-badge">{typeDetails.label}</span>
        <section className="detail-section"><h4>About this node</h4><p>{typeDetails.summary}</p></section>
        {!isCenter && (
          <>
            <section className="detail-section">
              <h4>Why is it shown here?</h4>
              {relationshipPaths.map((path) => (
                <div className="relationship-path" key={path.center.node_id}>
                  <strong>{path.center.name}</strong>
                  <div className="relationship-path-relations">
                    {path.relationships.map((edge) => <span key={edge.relation}>{edge.display_relation}</span>)}
                  </div>
                  <strong>{entity.name}</strong>
                </div>
              ))}
            </section>
            <section className="detail-section">
              <h4>Relationships</h4>
              <div className="relationship-explanations">
                {relationshipPaths.flatMap((path) => path.relationships.map((edge) => {
                  const explanation = RELATION_EXPLANATIONS[edge.relation]
                  return (
                    <article key={`${path.center.node_id}:${edge.relation}`}>
                      <strong>{relationshipPaths.length > 1 ? `${path.center.name} · ${edge.display_relation}` : edge.display_relation}</strong>
                      <p>{explanation?.text || 'The G3 graph records this relationship with the selected drug.'}</p>
                      {explanation?.note && <small>{explanation.note}</small>}
                    </article>
                  )
                }))}
              </div>
            </section>
          </>
        )}
        {!isCenter && metadata && (
          <section className="detail-section entity-detail-section">
            <h4>Entity information</h4>
            <dl className="entity-detail-list">
              {metadata.official_symbol && <div><dt>Current NCBI symbol</dt><dd>{metadata.official_symbol}</dd></div>}
              {metadata.official_full_name && <div><dt>Official full name</dt><dd>{metadata.official_full_name}</dd></div>}
              {metadata.organism && <div><dt>Organism</dt><dd>{metadata.organism}{metadata.taxonomy_id && <small>Taxonomy ID {metadata.taxonomy_id}</small>}</dd></div>}
              {aliases.length > 0 && (
                <div><dt>Aliases</dt><dd>
                  <span className="gene-alias-list">{visibleAliases.map((alias) => <span key={alias}>{alias}</span>)}</span>
                  {aliases.length > 5 && <button className="detail-expand-button" type="button" onClick={() => setShowAllAliases((current) => !current)}>{showAllAliases ? 'Show fewer' : `Show all aliases (${aliases.length})`}</button>}
                </dd></div>
              )}
              {metadata.summary && (
                <div><dt>NCBI summary</dt><dd>
                  <p className={`gene-summary ${showFullSummary ? 'expanded' : ''}`}>{metadata.summary}</p>
                  {summaryCanExpand && <button className="detail-expand-button" type="button" onClick={() => setShowFullSummary((current) => !current)}>{showFullSummary ? 'Show less' : 'Show full summary'}</button>}
                  {(metadata.summary_source || metadata.summary_date) && <small>{[metadata.summary_source, metadata.summary_date].filter(Boolean).join(' · ')}</small>}
                </dd></div>
              )}
            </dl>
            <div className="entity-detail-subsection">
              <h5>Source</h5>
              <p>NCBI Gene</p>
              {metadata.source_modified_date && <small>Source modified: {metadata.source_modified_date}</small>}
            </div>
            <div className="entity-detail-subsection">
              <h5>Identifiers</h5>
              <dl className="entity-detail-list compact">
                <div><dt>Gene ID</dt><dd>{entity.entity_id}</dd></div>
                {metadata.replacement_gene_id && <div><dt>NCBI replacement GeneID</dt><dd>{metadata.replacement_gene_id}</dd></div>}
              </dl>
            </div>
            <p className="entity-detail-disclaimer">Entity metadata is provided for identification and context. It was not used as textual input to the R-GCN model and does not explain the model&apos;s score.</p>
          </section>
        )}
        {!isCenter && entity.entity_type === 'gene/protein' && !metadata && <section className="detail-section metadata-unavailable"><h4>Entity metadata</h4><p>No additional NCBI metadata is included for this node.</p></section>}
        {entity.entity_type === 'drug' && (
          <section className="detail-section entity-detail-section">
            <h4>Entity information</h4>
            <dl className="entity-detail-list">
              {[
                ['what_is_this_drug', 'What is this drug?'], ['general_use', 'General use'],
                ['active_substance', 'Active substance'], ['drug_class', 'Drug class'],
              ].map(([field, label]) => (
                <div key={field}><dt>{label}</dt><dd>{field === 'active_substance'
                  ? displaySubstance(entity.metadata?.drug_information?.[field] || entity.name, entity.name)
                  : entity.metadata?.drug_information?.[field] || 'Not available from the verified source.'}</dd></div>
              ))}
            </dl>
            <div className="entity-detail-subsection"><h5>Source</h5><ul className="entity-detail-source-list">{(entity.metadata?.drug_information?.sources?.length ? entity.metadata.drug_information.sources : ['CHEERS entity inventory (substance label only)']).map((source) => <li key={source}>{source}</li>)}</ul></div>
            {(entity.metadata?.drug_information?.unii || entity.metadata?.drug_information?.provenance?.chembl_id) && <div className="entity-detail-subsection"><h5>Identifiers</h5><dl className="entity-detail-list compact">{entity.metadata?.drug_information?.unii && <div><dt>UNII</dt><dd>{entity.metadata.drug_information.unii}</dd></div>}{entity.metadata?.drug_information?.provenance?.chembl_id && <div><dt>ChEMBL 37</dt><dd>{entity.metadata.drug_information.provenance.chembl_id}</dd></div>}</dl></div>}
            {entity.metadata?.drug_information?.general_use && <p className="entity-detail-note">Selected source-listed indications. These do not establish current approval for every formulation.</p>}
            <p className="entity-detail-disclaimer">General entity information only.<br />Not used by the R-GCN model.</p>
          </section>
        )}
        {entity.entity_type === 'disease' && <section className="detail-section entity-detail-section"><h4>Entity description</h4><p>{entity.metadata?.description || 'No additional description is available for this entity.'}</p>{entity.metadata?.description && <><div className="entity-detail-subsection"><h5>Source</h5><p>{entity.metadata.source}</p></div><div className="entity-detail-subsection"><h5>Identifiers</h5><dl className="entity-detail-list compact"><div><dt>Identifier</dt><dd>{entity.metadata.source_id}</dd></div><div><dt>License</dt><dd>{entity.metadata.license}</dd></div></dl></div></>}</section>}
        <p className="entity-detail-disclaimer panel-disclaimer">Entity descriptions are provided only for identification and general context. They were not used as textual input to the R-GCN model, do not explain the model&apos;s scores or predictions, and are not evidence of a drug–drug interaction or clinical guidance.</p>
        <section className="detail-section entity-information">
          <h4>{entity.entity_type === 'drug' ? 'Graph identity' : 'Entity information'}</h4>
          <dl><div><dt>Entity type</dt><dd>{typeDetails.label}</dd></div><div><dt>{typeDetails.idLabel}</dt><dd>{entity.entity_id}</dd></div><div><dt>Graph node ID</dt><dd>{entity.node_id}</dd></div><div><dt>Source</dt><dd>{entity.source}</dd></div>{isCenter && <div><dt>Role</dt><dd>Selected drug</dd></div>}</dl>
        </section>
      </div>
    )
  }

  const { center: source, neighbor, displayRelation, relation } = selected.data
  return <div className="subgraph-detail-content"><span className="card-kicker">Graph relationship</span><h3>{displayRelation}</h3><dl><div><dt>Source</dt><dd>{source.name}</dd></div><div><dt>Relation</dt><dd>{displayRelation} <small>{relation}</small></dd></div><div><dt>Target</dt><dd>{neighbor.name}</dd></div><div><dt>Status</dt><dd>Known G3 graph relationship</dd></div><div><dt>{relation === 'drug_drug' ? 'DDI scope' : 'Context scope'}</dt><dd>{relation === 'drug_drug' ? 'Training-only G3 relationship' : 'G3 forward support relationship'}</dd></div><div><dt>Predicted</dt><dd>No</dd></div></dl></div>
}
