"""Independently verify deterministic descriptions against exact frozen sources."""
import argparse
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

def require(condition, message):
    if not condition:
        raise ValueError(message)

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            value.update(block)
    return {'byte_size': path.stat().st_size, 'sha256': value.hexdigest()}

def rows(path):
    require(path.is_file() and not path.is_symlink(), 'Expected regular artifact')
    raw = path.read_bytes()
    require(raw.endswith(b'\n') and b'\r' not in raw, 'Invalid UTF-8/LF artifact')
    return [json.loads(line) for line in raw.decode('utf-8').splitlines()]

def manifest(path):
    raw = path.read_bytes()
    require(raw.endswith(b'\n') and b'\r' not in raw, 'Manifest UTF-8/LF convention')
    records = json.loads(raw.decode('utf-8'))
    require(raw == (json.dumps(records, indent=2, sort_keys=True) + '\n').encode('utf-8'),
            'Noncanonical manifest encoding/order')
    require(records['schema_version'] == 1, 'Manifest version')
    portable = path.name == 'DISEASE_DESCRIPTIONS_MANIFEST.json'
    expected_inputs = {'final_release/entity_metadata_runtime/entity_description_inventory.jsonl',
                       'final_release/entity_metadata_runtime/disease_source_mapping.jsonl'}
    expected_outputs = {'final_release/entity_metadata_runtime/disease_descriptions.jsonl'}
    if not portable:
        expected_inputs |= {'data/downloads/chembl/chembl_37/chembl_37.db',
            'data/downloads/unichem/20260905T155310164921Z-efab38b436b7a7b9/src1src2.txt.gz'}
        expected_outputs |= {'data/derived/entity_descriptions/drug_descriptions.jsonl',
                             'data/derived/entity_descriptions/drug_mapping_evidence.jsonl'}
    require(set(records['inputs']) == expected_inputs and set(records['outputs']) == expected_outputs,
            'Manifest source/output coverage')
    for name, expected in (
        ('entity_description_inventory.jsonl', '239d8d0be347abc9a47fc93a501fd6efb5391cb352dd20281891fb35c2c7ba9b'),
        ('disease_source_mapping.jsonl', 'f22ee4b7f2fc495b7256d72aa7e38ca0058ba8e06de81911d55cdceedf0fb277'),
    ):
        require(records['inputs']['final_release/entity_metadata_runtime/' + name]['sha256'] == expected,
                'Wrong verified identity/source pin')
    for name, expected in records['inputs'].items():
        target = ROOT / name
        require(target.resolve().is_relative_to(ROOT) and target.is_file(), 'Invalid input path')
        require(digest(target) == expected, 'Input fingerprint: ' + name)
    for name, expected in records['outputs'].items():
        target = ROOT / name
        require(target.resolve().is_relative_to(ROOT), 'Invalid output path')
        require(digest(target) == {k:expected[k] for k in ('byte_size', 'sha256')}, 'Output fingerprint: ' + name)
        require(len(rows(target)) == expected['record_count'], 'Output count')
    return records

FIELDS = {'description', 'status', 'reason_codes', 'source', 'source_id', 'source_release', 'evidence', 'license'}

def identities(actual, expected):
    require(len(actual) == len(expected), 'Identity count')
    seen = set()
    for row, identity in zip(actual, expected):
        require(set(row) == set(identity) | {'metadata'}, 'Unexpected artifact fields')
        require(all(row[k] == v for k,v in identity.items()), 'Exact identity/order mismatch')
        key = (row['entity_type'], row['entity_id'])
        require(key not in seen, 'Duplicate exact identity')
        seen.add(key)
        require(set(row['metadata']) == FIELDS, 'Unsupported metadata fields')

def verify(require_source=False):
    inventory = rows(RUNTIME / 'entity_description_inventory.jsonl')
    require(Counter(r['entity_type'] for r in inventory) == {'drug':4278, 'disease':2010}, 'Inventory count')
    manifest(RUNTIME / 'DISEASE_DESCRIPTIONS_MANIFEST.json')
    diseases = rows(RUNTIME / 'disease_descriptions.jsonl')
    identities(diseases, [r for r in inventory if r['entity_type'] == 'disease'])
    source = {r['entity_id']:r for r in rows(RUNTIME / 'disease_source_mapping.jsonl')}
    for row in diseases:
        origin = source[row['entity_id']]
        description = None
        if origin['review_status'] == 'approved' and origin['cheers_source'] == 'MONDO':
            description = origin.get('source_fields', {}).get('definition') or None
        require(row['metadata'] == {'description':description, 'status':origin['review_status'],
            'reason_codes':origin['reason_codes'], 'source':'MONDO', 'source_id':origin['mapping'].get('source_id'),
            'source_release':origin['source_snapshot']['release'], 'evidence':origin['mapping']['method'],
            'license':'CC BY 4.0'}, 'Disease meaning/provenance changed')
    print('PASS: 2,010 exact disease identities; original definitions, grouped safeguards and provenance.')
    if not LOCAL.exists():
        require(not require_source, 'Required local descriptions absent')
        print('SKIP: local drug descriptions absent; portable disease artifact verified.')
        return
    local_manifest = manifest(LOCAL / 'MANIFEST.json')
    database = ROOT / 'data/downloads/chembl/chembl_37/chembl_37.db'
    require(local_manifest['inputs']['data/downloads/chembl/chembl_37/chembl_37.db']['sha256'] ==
        '4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142', 'Wrong ChEMBL pin')
    pair = ROOT / 'data/downloads/unichem/20260905T155310164921Z-efab38b436b7a7b9/src1src2.txt.gz'
    require(digest(pair)['sha256'] == 'efab38b436b7a7b9b3c51f66db91e33202450ed0ed34e08381206bb10c57ddbd', 'Wrong UniChem pin')
    payload = gzip.decompress(pair.read_bytes())
    require(hashlib.sha256(payload).hexdigest() == 'c3370b5727a1da2d5abbbf98e3a1f6e34f752a5f4f887c46e0f2d8702ec0d4da', 'Wrong pair bytes')
    lines = payload.decode('utf-8').splitlines()
    require(lines[0] == "From src:'1'\tTo src:'2'", 'Wrong orientation')
    pairs = defaultdict(set)
    for line in lines[1:]:
        left, right = line.split('\t')
        pairs[right].add(left)
    drugs = rows(LOCAL / 'drug_descriptions.jsonl')
    identities(drugs, [r for r in inventory if r['entity_type'] == 'drug'])
    evidence = rows(LOCAL / 'drug_mapping_evidence.jsonl')
    require(len(evidence) == len(drugs), 'Evidence count')
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro&immutable=1', uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        for row, recorded in zip(drugs, evidence):
            require(set(recorded) == (set(row) - {'metadata'}) | {'targets', 'facts', 'status', 'reason_codes'},
                    'Unexpected evidence fields')
            require(all(recorded[k] == row[k] for k in row if k != 'metadata'), 'Evidence identity')
            targets = sorted(pairs[row['entity_id']])
            require(recorded['targets'] == targets, 'Exact UniChem assignments')
            facts = []
            reasons = set()
            if len(targets) > 1:
                reasons.add('multiple_chembl_ids')
            for target in targets:
                molecule = conn.execute('SELECT molregno,chembl_id,pref_name,molecule_type,max_phase,first_approval FROM molecule_dictionary WHERE chembl_id=?', (target,)).fetchone()
                if molecule is None:
                    reasons.add('chembl_record_missing')
                    continue
                f = dict(molecule)
                structure = conn.execute('SELECT standard_inchi_key,canonical_smiles,standard_inchi FROM compound_structures WHERE molregno=?', (f['molregno'],)).fetchone()
                hierarchy = conn.execute('SELECT parent_molregno,active_molregno FROM molecule_hierarchy WHERE molregno=?', (f['molregno'],)).fetchone()
                f['standard_inchi_key'] = structure[0] if structure else None
                f['multicomponent'] = int(bool(structure and structure[1] and '.' in structure[1]))
                f['isotope_layer'] = int(bool(structure and structure[2] and '/i' in structure[2]))
                f['parent_molregno'] = hierarchy[0] if hierarchy else None
                f['active_molregno'] = hierarchy[1] if hierarchy else None
                facts.append(f)
                checks = {
                    'structure_unavailable':not f['standard_inchi_key'],
                    'non_small_molecule_or_unspecified':f['molecule_type'] != 'Small molecule',
                    'hierarchy_unavailable':f['parent_molregno'] is None,
                    'parent_form_mismatch':f['parent_molregno'] is not None and f['parent_molregno'] != f['molregno'],
                    'active_form_difference':f['active_molregno'] not in (None, f['molregno']),
                    'multicomponent_structure':bool(f['multicomponent']),
                    'isotope_layer_present':bool(f['isotope_layer']),
                }
                reasons.update(k for k,v in checks.items() if v)
            if not targets:
                status, reasons = 'unresolved', {'no_unichem_assignment'}
            else:
                status = 'needs_review' if reasons else 'approved'
            require(recorded['facts'] == facts and recorded['status'] == status and recorded['reason_codes'] == sorted(reasons), 'Mapping policy/source facts')
            description = None
            if status == 'approved':
                sentences = []
                if facts[0]['pref_name']:
                    sentences.append('ChEMBL 37 records the preferred name as ' + facts[0]['pref_name'] + '.')
                sentences.append('The reported molecule type is small molecule.')
                description = ' '.join(sentences)
            require(row['metadata'] == {'description':description, 'status':status, 'reason_codes':sorted(reasons),
                'source':'ChEMBL 37','source_id':targets[0] if status == 'approved' else None,
                'source_release':'37','evidence':'unichem_reported_cross_reference','license':'CC BY-SA 3.0'},
                'Unsupported drug description or provenance')
    require(local_manifest['drug_status_counts'] == dict(Counter(r['status'] for r in evidence)), 'Status totals')
    require(local_manifest['disease_status_counts'] == dict(Counter(r['metadata']['status'] for r in diseases)), 'Disease totals')
    print('PASS: 4,278 exact drug identities; independent SQLite facts, policy, templates, order and fingerprints.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-source', action='store_true')
    verify(parser.parse_args().require_source)
