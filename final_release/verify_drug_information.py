"""Independent offline reconstruction of the drug information card."""
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
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT/'data/derived/entity_descriptions'
SOURCE = ROOT/'final_release/source_provenance/drug_information/SOURCE_MANIFEST.json'
PINS = [('data/downloads/fda_unii/2026-08-04/UNII_Data_20260804.zip',14477857,
         'e768525350d17e0eedfa179e62563226e9da0a3d5bda006d27b7b94600a76ee9'),
        ('data/downloads/dailymed/2026-09-05/pharmacologic_class_indexing_spl_files.zip',4051518,
         '105b3631eb8a9c409828d5f89d0be338904482b97acc35d6b8ced1381a0a1f69')]
N = '{urn:hl7-org:v3}'

def require(ok, message):
    if not ok: raise ValueError(message)

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(8*1024*1024),b''):h.update(block)
    return h.hexdigest()

def document(path):
    b=path.read_bytes()
    require(b.endswith(b'\n') and b'\r' not in b,'UTF-8/LF/final newline')
    return b.decode('utf-8')

def verify():
    source=json.loads(document(SOURCE))
    require(source['schema_version']==1 and len(source['sources'])==2,'Source schema')
    for record,(name,size,digest) in zip(source['sources'],PINS):
        require(record['path']==name and record['byte_size']==size and record['sha256']==digest,'Source pin')
        require((ROOT/name).stat().st_size==size and sha(ROOT/name)==digest,'Raw source fingerprint')
        expected_url = ('https://precision.fda.gov/uniisearch/archive/2026-08-04/UNII_Data_20260804.zip'
            if 'fda_unii' in name else 'https://dailymed-data.nlm.nih.gov/public-release-files/pharmacologic_class_indexing_spl_files.zip')
        require(record['url']==expected_url,'Exact source URL')
        start,end=(datetime.fromisoformat(record[k].replace('Z','+00:00')) for k in ('started_utc','completed_utc'))
        require(start.tzinfo is not None and end.tzinfo is not None and start<=end,'Retrieval interval')
        if 'fda_unii' in name:require(record['release']=='2026-08-04','FDA release')
    bykey=defaultdict(list)
    with zipfile.ZipFile(ROOT/PINS[0][0]) as archive:
        require(archive.testzip() is None,'FDA ZIP CRC')
        reader=csv.DictReader(io.StringIO(archive.read('UNII_Records_4Aug2026.txt').decode('utf-8')),delimiter='\t')
        for r in reader:
            if r['INCHIKEY']:bykey[r['INCHIKEY']].append({k:r[k] for k in
                ['UNII','DISPLAY_NAME','INCHIKEY','INGREDIENT_TYPE','SUBSTANCE_TYPE']})
    epcs=defaultdict(list)
    with zipfile.ZipFile(ROOT/PINS[1][0]) as archive:
        require(len(archive.infolist())==2964 and archive.testzip() is None,'DailyMed ZIP')
        for member in sorted(archive.namelist()):
            with zipfile.ZipFile(io.BytesIO(archive.read(member))) as inner:
                require(inner.testzip() is None,'Nested ZIP CRC')
                for name in sorted(inner.namelist()):
                    if not name.endswith('.xml'):continue
                    root=ET.fromstring(inner.read(name))
                    require(root.find(N+'code').get('code')=='60685-5','Indexing type')
                    for item in root.iter(N+'identifiedSubstance'):
                        code=item.find(N+'code')
                        if code is None:continue
                        require(code.get('codeSystem')=='2.16.840.1.113883.4.9','UNII coding system')
                        for kind in item.findall(N+'asSpecializedKind/'+N+'generalizedMaterialKind'):
                            cls=kind.find(N+'code');label=cls.get('displayName','')
                            if label.endswith(' [EPC]'):
                                epcs[code.get('code')].append({'label':label[:-6], 'code':cls.get('code'),
                                    'code_system':cls.get('codeSystem'),'set_id':root.find(N+'setId').get('root'),
                                    'version':root.find(N+'versionNumber').get('value'),
                                    'effective_time':root.find(N+'effectiveTime').get('value'),
                                    'archive_member':member,'xml_member':name})
    manifest=json.loads(document(LOCAL/'DRUG_INFORMATION_MANIFEST.json'))
    expected_inputs={
        'final_release/entity_metadata_runtime/entity_description_inventory.jsonl':'239d8d0be347abc9a47fc93a501fd6efb5391cb352dd20281891fb35c2c7ba9b',
        'data/derived/entity_descriptions/drug_mapping_evidence.jsonl':'aed9e66d03ea53be5e7603cc555930054f076ae5d3bee54b3bba739e8a7da6f7',
        'data/downloads/chembl/chembl_37/chembl_37.db':'4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142',
        SOURCE.relative_to(ROOT).as_posix():sha(SOURCE)}
    require(manifest['inputs']==expected_inputs,'Input pins/coverage')
    for path,value in expected_inputs.items():require(sha(ROOT/path)==value,'Input content '+path)
    output=LOCAL/'drug_information.jsonl'
    require(output.stat().st_size==manifest['output_byte_size'] and sha(output)==manifest['output_sha256'],'Output fingerprint')
    actual=[json.loads(l) for l in document(output).splitlines()]
    inventory=[json.loads(l) for l in document(ROOT/'final_release/entity_metadata_runtime/entity_description_inventory.jsonl').splitlines()]
    inventory=[r for r in inventory if r['entity_type']=='drug']
    evidence=[json.loads(l) for l in document(LOCAL/'drug_mapping_evidence.jsonl').splitlines()]
    require(len(actual)==len(inventory)==len(evidence)==manifest['record_count']==4278,'Exact counts')
    require(len({(r['entity_type'],r['entity_id']) for r in actual})==4278,'Duplicate identities')
    coverage=Counter()
    database=ROOT/'data/downloads/chembl/chembl_37/chembl_37.db'
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro&immutable=1',uri=True)) as db:
        db.row_factory=sqlite3.Row
        for row,identity,ev in zip(actual,inventory,evidence):
            require(set(row)==set(identity)|{'information'} and all(row[k]==v for k,v in identity.items()),'Exact identity/order')
            require(all(ev[k]==v for k,v in identity.items()),'Evidence identity')
            approved=ev['status']=='approved'
            candidates=sorted(bykey.get(ev['facts'][0]['standard_inchi_key'],[]),key=lambda r:r['UNII']) if approved else []
            bridge=candidates[0] if len(candidates)==1 and candidates[0]['INGREDIENT_TYPE']=='INGREDIENT SUBSTANCE' and candidates[0]['SUBSTANCE_TYPE']=='chemical' else None
            classes=epcs.get(bridge['UNII'],[]) if bridge else []
            names=sorted({r['label'] for r in classes})
            category='; '.join(names) if 1<=len(names)<=3 else None
            indications=[]
            if approved:
                f=ev['facts'][0]
                for ind in db.execute('SELECT drugind_id,mesh_id,mesh_heading,max_phase_for_ind FROM drug_indication WHERE molregno=?',(f['molregno'],)):
                    if ind['max_phase_for_ind']!=4:continue
                    for ref in db.execute('SELECT ref_type,ref_id,ref_url FROM indication_refs WHERE drugind_id=?',(ind['drugind_id'],)):
                        if ref['ref_type'] in {'DailyMed','FDA','EMA'}:
                            indications.append({'mesh_id':ind['mesh_id'],'mesh_heading':ind['mesh_heading'],**dict(ref)})
            indications=[dict(zip(('mesh_id','mesh_heading','ref_type','ref_id','ref_url'),r)) for r in sorted({
                tuple(r[k] for k in ('mesh_id','mesh_heading','ref_type','ref_id','ref_url')) for r in indications})]
            uses=sorted({(r['mesh_id'],r['mesh_heading']) for r in indications},key=lambda p:(len(p[1]),p[1],p[0]))[:3]
            expected={'what_is_this_drug':category or (ev['facts'][0]['molecule_type'] if approved else None),
                'general_use':'; '.join(p[1] for p in uses) or None,'active_substance':bridge['DISPLAY_NAME'] if bridge else identity['display_name'],
                'drug_class':category,'mapping_status':ev['status'],'unii':bridge['UNII'] if bridge else None,
                'sources':sorted(set(['CHEERS entity inventory']+(['ChEMBL 37'] if approved else [])+
                    (['FDA UNII 2026-08-04'] if bridge else [])+(['FDA EPC / DailyMed'] if category else []))),
                'field_provenance':{'what_is_this_drug':'FDA EPC / DailyMed' if category else ('ChEMBL 37 molecule_type' if approved else None),
                    'general_use':'ChEMBL 37: selected phase-4 indication names with DailyMed/FDA/EMA references' if uses else None,
                    'active_substance':'FDA UNII preferred substance name' if bridge else 'CHEERS canonical entity label; active moiety not resolved',
                    'drug_class':'FDA EPC / DailyMed' if category else None},
                'provenance':{'chembl_id':ev['targets'][0] if approved else None,'unii_candidates':candidates,'epc':classes,
                    'indications':indications,'selected_mesh_ids':[p[0] for p in uses],
                    'identity_basis':'Frozen UniChem cross-reference; unique full InChIKey FDA bridge only; no parent substitution'}}
            require(row['information']==expected,'Unsupported fields/content/provenance: '+identity['entity_id'])
            coverage['full' if all(expected[k] for k in ('what_is_this_drug','general_use','active_substance','drug_class'))
                     else 'active_substance_only' if not expected['what_is_this_drug'] and not expected['general_use'] else 'partial']+=1
    require(dict(coverage)==manifest['coverage'],'Coverage counts')
    print('PASS: pinned FDA/DailyMed archives, exact bridge, EPC-only classes, label-referenced indications, all 4,278 cards and provenance.')
    print(dict(coverage))

if __name__=='__main__':verify()
