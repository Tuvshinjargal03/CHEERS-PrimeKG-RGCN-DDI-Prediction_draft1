"""Build deterministic entity context; drug-linked outputs remain local only.

Run the source verifiers first. This builder also fingerprints its exact inputs.
No network, identity normalization, parent substitution, or model integration.
"""
from collections import Counter, defaultdict
from contextlib import closing
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'final_release/entity_metadata_runtime'
LOCAL = ROOT / 'data/derived/entity_descriptions'
SNAPSHOT = '20260905T155310164921Z-efab38b436b7a7b9'
DB = ROOT / 'data/downloads/chembl/chembl_37/chembl_37.db'
PAIR = ROOT / 'data/downloads/unichem' / SNAPSHOT / 'src1src2.txt.gz'
SQL = '''SELECT m.molregno, m.chembl_id, m.pref_name, m.molecule_type,
 m.max_phase, m.first_approval, s.standard_inchi_key,
 h.parent_molregno, h.active_molregno,
 CASE WHEN instr(s.canonical_smiles, '.') > 0 THEN 1 ELSE 0 END AS multicomponent,
 CASE WHEN instr(s.standard_inchi, '/i') > 0 THEN 1 ELSE 0 END AS isotope_layer
 FROM molecule_dictionary m LEFT JOIN compound_structures s USING(molregno)
 LEFT JOIN molecule_hierarchy h USING(molregno) WHERE m.chembl_id = ?'''

def fingerprint(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return {'byte_size': path.stat().st_size, 'sha256': digest.hexdigest()}

def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]

def write_rows(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b''.join((json.dumps(row, ensure_ascii=False, sort_keys=True,
        separators=(',', ':')) + '\n').encode('utf-8') for row in rows))

def classify(targets, facts):
    if not targets:
        return 'unresolved', ['no_unichem_assignment']
    reasons = []
    if len(targets) != 1:
        reasons.append('multiple_chembl_ids')
    if len(facts) != len(targets):
        reasons.append('chembl_record_missing')
    for f in facts:
        if not f['standard_inchi_key']:
            reasons.append('structure_unavailable')
        if f['molecule_type'] != 'Small molecule':
            reasons.append('non_small_molecule_or_unspecified')
        if f['parent_molregno'] is None:
            reasons.append('hierarchy_unavailable')
        elif f['parent_molregno'] != f['molregno']:
            reasons.append('parent_form_mismatch')
        if f['active_molregno'] not in (None, f['molregno']):
            reasons.append('active_form_difference')
        if f['multicomponent']:
            reasons.append('multicomponent_structure')
        if f['isotope_layer']:
            reasons.append('isotope_layer_present')
    return ('needs_review' if reasons else 'approved'), sorted(set(reasons))

def main():
    inventory = read_rows(RUNTIME / 'entity_description_inventory.jsonl')
    if Counter(r['entity_type'] for r in inventory) != {'drug': 4278, 'disease': 2010}:
        raise ValueError('Inventory count mismatch')
    keys = [(r['entity_type'], r['entity_id']) for r in inventory]
    if len(set(keys)) != 6288:
        raise ValueError('Duplicate inventory identity')
    inputs = {str(p.relative_to(ROOT)).replace('\\', '/'): fingerprint(p) for p in
              (RUNTIME / 'entity_description_inventory.jsonl', RUNTIME / 'disease_source_mapping.jsonl', PAIR, DB)}
    for name, expected in (
        ('entity_description_inventory.jsonl', '239d8d0be347abc9a47fc93a501fd6efb5391cb352dd20281891fb35c2c7ba9b'),
        ('disease_source_mapping.jsonl', 'f22ee4b7f2fc495b7256d72aa7e38ca0058ba8e06de81911d55cdceedf0fb277'),
    ):
        if inputs['final_release/entity_metadata_runtime/' + name]['sha256'] != expected:
            raise ValueError('Verified identity/source input changed: ' + name)
    if inputs[str(DB.relative_to(ROOT)).replace('\\', '/')]['sha256'] != '4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142':
        raise ValueError('Pinned ChEMBL database mismatch')
    if fingerprint(PAIR)['sha256'] != 'efab38b436b7a7b9b3c51f66db91e33202450ed0ed34e08381206bb10c57ddbd':
        raise ValueError('Pinned UniChem mapping mismatch')
    payload = gzip.decompress(PAIR.read_bytes())
    if hashlib.sha256(payload).hexdigest() != 'c3370b5727a1da2d5abbbf98e3a1f6e34f752a5f4f887c46e0f2d8702ec0d4da':
        raise ValueError('Decompressed mapping mismatch')
    lines = payload.decode('utf-8').splitlines()
    if lines[0] != "From src:'1'\tTo src:'2'":
        raise ValueError('Wrong mapping orientation')
    mapping = defaultdict(set)
    for line in lines[1:]:
        chembl, drugbank = line.split('\t')
        mapping[drugbank].add(chembl)
    evidence, drugs = [], []
    with closing(sqlite3.connect(DB.resolve().as_uri() + '?mode=ro&immutable=1', uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        for identity in inventory:
            if identity['entity_type'] != 'drug':
                continue
            targets = sorted(mapping.get(identity['entity_id'], ()))
            facts = []
            for target in targets:
                result = conn.execute(SQL, (target,)).fetchone()
                if result is not None:
                    facts.append(dict(result))
            status, reasons = classify(targets, facts)
            evidence.append({**identity, 'targets': targets, 'facts': facts,
                             'status': status, 'reason_codes': reasons})
            description = None
            if status == 'approved':
                name = facts[0]['pref_name']
                description = (f'ChEMBL 37 records the preferred name as {name}. ' if name else '')
                description += 'The reported molecule type is small molecule.'
            drugs.append({**identity, 'metadata': {'description': description,
                'status': status, 'reason_codes': reasons, 'source': 'ChEMBL 37',
                'source_id': targets[0] if status == 'approved' else None,
                'source_release': '37', 'evidence': 'unichem_reported_cross_reference',
                'license': 'CC BY-SA 3.0'}})
    diseases = []
    disease_source = {r['entity_id']: r for r in read_rows(RUNTIME / 'disease_source_mapping.jsonl')}
    for identity in inventory:
        if identity['entity_type'] != 'disease':
            continue
        r = disease_source[identity['entity_id']]
        if any(r[k] != identity[k] for k in ('entity_type', 'entity_id', 'graph_node_id', 'display_name')):
            raise ValueError('Disease identity mismatch')
        description = r.get('source_fields', {}).get('definition') if r['review_status'] == 'approved' and r['cheers_source'] == 'MONDO' else None
        diseases.append({**identity, 'metadata': {'description': description or None,
            'status': r['review_status'], 'reason_codes': r['reason_codes'], 'source': 'MONDO',
            'source_id': r['mapping'].get('source_id'), 'source_release': r['source_snapshot']['release'],
            'evidence': r['mapping']['method'], 'license': 'CC BY 4.0'}})
    outputs = [(LOCAL / 'drug_mapping_evidence.jsonl', evidence),
               (LOCAL / 'drug_descriptions.jsonl', drugs),
               (RUNTIME / 'disease_descriptions.jsonl', diseases)]
    manifest = {'schema_version': 1, 'inputs': inputs, 'outputs': {},
                'drug_status_counts': dict(Counter(r['status'] for r in evidence)),
                'disease_status_counts': dict(Counter(r['metadata']['status'] for r in diseases))}
    for path, rows in outputs:
        write_rows(path, rows)
        manifest['outputs'][str(path.relative_to(ROOT)).replace('\\', '/')] = {**fingerprint(path), 'record_count': len(rows)}
    (LOCAL / 'MANIFEST.json').write_bytes((json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode())
    portable = {'schema_version': 1, 'inputs': {k:v for k,v in inputs.items() if k.startswith('final_release/')},
                'outputs': {k:v for k,v in manifest['outputs'].items() if k.startswith('final_release/')}}
    (RUNTIME / 'DISEASE_DESCRIPTIONS_MANIFEST.json').write_bytes((json.dumps(portable, indent=2, sort_keys=True) + '\n').encode())
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()
