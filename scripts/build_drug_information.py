"""Offline structured drug context from pinned FDA, DailyMed and ChEMBL facts."""
from collections import Counter, defaultdict
from contextlib import closing
import csv
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / 'data/derived/entity_descriptions'
SOURCE_MANIFEST = ROOT / 'final_release/source_provenance/drug_information/SOURCE_MANIFEST.json'
NS = {'s': 'urn:hl7-org:v3'}

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(8*1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()

def jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]

def sources():
    manifest = json.loads(SOURCE_MANIFEST.read_bytes())
    for source in manifest['sources']:
        path = ROOT / source['path']
        if path.stat().st_size != source['byte_size'] or sha(path) != source['sha256']:
            raise ValueError('Source fingerprint mismatch: ' + source['path'])
    by_key = defaultdict(list)
    with zipfile.ZipFile(ROOT / manifest['sources'][0]['path']) as archive:
        with archive.open('UNII_Records_4Aug2026.txt') as handle:
            for row in csv.DictReader(io.TextIOWrapper(handle, encoding='utf-8'), delimiter='\t'):
                if row['INCHIKEY']:
                    by_key[row['INCHIKEY']].append({k:row[k] for k in
                        ('UNII','DISPLAY_NAME','INCHIKEY','INGREDIENT_TYPE','SUBSTANCE_TYPE')})
    classes = defaultdict(list)
    with zipfile.ZipFile(ROOT / manifest['sources'][1]['path']) as archive:
        for member in sorted(archive.namelist()):
            with zipfile.ZipFile(io.BytesIO(archive.read(member))) as inner:
                for xml_name in sorted(inner.namelist()):
                    if not xml_name.endswith('.xml'):
                        continue
                    doc = ET.fromstring(inner.read(xml_name))
                    if doc.find('s:code', NS).get('code') != '60685-5':
                        raise ValueError('Unexpected indexing document')
                    for substance in doc.findall('.//s:subject/s:identifiedSubstance/s:identifiedSubstance', NS):
                        identifier = substance.find('s:code', NS)
                        if identifier.get('codeSystem') != '2.16.840.1.113883.4.9':
                            raise ValueError('Expected exact UNII')
                        for code in substance.findall('s:asSpecializedKind/s:generalizedMaterialKind/s:code', NS):
                            label = code.get('displayName', '')
                            if label.endswith(' [EPC]'):
                                classes[identifier.get('code')].append({
                                    'label':label.removesuffix(' [EPC]'), 'code':code.get('code'),
                                    'code_system':code.get('codeSystem'),
                                    'set_id':doc.find('s:setId', NS).get('root'),
                                    'version':doc.find('s:versionNumber', NS).get('value'),
                                    'effective_time':doc.find('s:effectiveTime', NS).get('value'),
                                    'archive_member':member, 'xml_member':xml_name})
    return by_key, classes

def make_information(identity, evidence, candidates, epc, indications):
    approved = evidence['status'] == 'approved'
    bridge = candidates[0] if approved and len(candidates) == 1 and candidates[0]['INGREDIENT_TYPE'] == 'INGREDIENT SUBSTANCE' and candidates[0]['SUBSTANCE_TYPE'] == 'chemical' else None
    epc = epc if bridge else []
    labels = sorted({item['label'] for item in epc})
    drug_class = '; '.join(labels) if 0 < len(labels) <= 3 else None
    what = drug_class or (evidence['facts'][0]['molecule_type'] if approved else None)
    uses = sorted({(r['mesh_id'],r['mesh_heading']) for r in indications}, key=lambda x:(len(x[1]),x[1],x[0]))[:3] if approved else []
    active = bridge['DISPLAY_NAME'] if bridge else identity['display_name']
    return {
        'what_is_this_drug':what, 'general_use':'; '.join(x[1] for x in uses) or None,
        'active_substance':active, 'drug_class':drug_class,
        'mapping_status':evidence['status'], 'unii':bridge['UNII'] if bridge else None,
        'sources':sorted(set(['CHEERS entity inventory'] + (['ChEMBL 37'] if approved else [])
            + (['FDA UNII 2026-08-04'] if bridge else []) + (['FDA EPC / DailyMed'] if drug_class else []))),
        'field_provenance':{
            'what_is_this_drug':'FDA EPC / DailyMed' if drug_class else ('ChEMBL 37 molecule_type' if approved else None),
            'general_use':'ChEMBL 37: selected phase-4 indication names with DailyMed/FDA/EMA references' if uses else None,
            'active_substance':'FDA UNII preferred substance name' if bridge else 'CHEERS canonical entity label; active moiety not resolved',
            'drug_class':'FDA EPC / DailyMed' if drug_class else None},
        'provenance':{'chembl_id':evidence['targets'][0] if approved else None,
            'unii_candidates':candidates, 'epc':epc,
            'indications':indications if approved else [], 'selected_mesh_ids':[x[0] for x in uses],
            'identity_basis':'Frozen UniChem cross-reference; unique full InChIKey FDA bridge only; no parent substitution'},
    }

def main():
    inventory_path = ROOT / 'final_release/entity_metadata_runtime/entity_description_inventory.jsonl'
    evidence_path = LOCAL / 'drug_mapping_evidence.jsonl'
    database = ROOT / 'data/downloads/chembl/chembl_37/chembl_37.db'
    for path, expected in ((inventory_path,'239d8d0be347abc9a47fc93a501fd6efb5391cb352dd20281891fb35c2c7ba9b'),
        (evidence_path,'aed9e66d03ea53be5e7603cc555930054f076ae5d3bee54b3bba739e8a7da6f7'),
        (database,'4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142')):
        if sha(path) != expected: raise ValueError('Pinned input mismatch: ' + path.name)
    inventory = [r for r in jsonl(inventory_path) if r['entity_type']=='drug']
    evidence = jsonl(evidence_path)
    if len(inventory)!=4278 or len(evidence)!=4278: raise ValueError('Count mismatch')
    by_key, classes = sources()
    result = []
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro&immutable=1',uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        for identity, record in zip(inventory,evidence):
            if any(record[k]!=v for k,v in identity.items()): raise ValueError('Exact identity/order mismatch')
            candidates, epc, indications = [], [], []
            if record['status']=='approved':
                f = record['facts'][0]
                candidates = sorted(by_key.get(f['standard_inchi_key'],[]),key=lambda x:x['UNII'])
                if len(candidates)==1: epc = classes.get(candidates[0]['UNII'],[])
                indications = [dict(r) for r in conn.execute('''SELECT DISTINCT d.mesh_id,d.mesh_heading,
                    r.ref_type,r.ref_id,r.ref_url FROM drug_indication d JOIN indication_refs r USING(drugind_id)
                    WHERE d.molregno=? AND d.max_phase_for_ind=4 AND r.ref_type IN ('DailyMed','FDA','EMA')
                    ORDER BY d.mesh_id,d.mesh_heading,r.ref_type,r.ref_id,r.ref_url''',(f['molregno'],))]
            result.append({**identity,'information':make_information(identity,record,candidates,epc,indications)})
    output = LOCAL / 'drug_information.jsonl'
    output.write_bytes(b''.join((json.dumps(r,sort_keys=True,ensure_ascii=False,separators=(',',':'))+'\n').encode() for r in result))
    manifest = {'schema_version':1,'record_count':len(result),'output_sha256':sha(output),
        'output_byte_size':output.stat().st_size,'inputs':{p.relative_to(ROOT).as_posix():sha(p) for p in
        (inventory_path,evidence_path,database,SOURCE_MANIFEST)},'coverage':dict(Counter(
            'full' if all(r['information'][k] for k in ('what_is_this_drug','general_use','active_substance','drug_class'))
            else 'active_substance_only' if not r['information']['what_is_this_drug'] and not r['information']['general_use']
            else 'partial' for r in result))}
    (LOCAL/'DRUG_INFORMATION_MANIFEST.json').write_bytes((json.dumps(manifest,indent=2,sort_keys=True)+'\n').encode())
    print(json.dumps(manifest,indent=2))

if __name__ == '__main__': main()
