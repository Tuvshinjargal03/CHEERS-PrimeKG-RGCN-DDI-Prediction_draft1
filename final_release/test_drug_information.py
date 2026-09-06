"""Meaningful card safety and exact-key API regression tests."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
import io

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.entity_metadata import EntityMetadataStore

LOCAL=ROOT/'data/derived/entity_descriptions'
INVENTORY=ROOT/'final_release/entity_metadata_runtime/entity_description_inventory.jsonl'

class CardTests(unittest.TestCase):
    def test_independent_verifier_rejects_rehashed_invention(self):
        spec=importlib.util.spec_from_file_location('independent',ROOT/'final_release/verify_drug_information.py')
        verifier=importlib.util.module_from_spec(spec);spec.loader.exec_module(verifier)
        real_sha=verifier.sha
        database=ROOT/'data/downloads/chembl/chembl_37/chembl_37.db'
        # Required standalone verification hashes the full DB. These mutation
        # tests exercise semantic reconstruction without repeatedly hashing 30GB.
        def test_sha(path):
            return '4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142' if path==database else real_sha(path)
        with tempfile.TemporaryDirectory() as folder,patch.object(verifier,'sha',side_effect=test_sha):
            verifier.LOCAL=Path(folder)
            (verifier.LOCAL/'drug_mapping_evidence.jsonl').write_bytes((LOCAL/'drug_mapping_evidence.jsonl').read_bytes())
            original=(LOCAL/'drug_information.jsonl').read_bytes()
            for field in ('drug_class','general_use'):
                rows=[json.loads(line) for line in original.splitlines()]
                next(r for r in rows if r['entity_id']=='DB01050')['information'][field]='Invented scientific statement'
                artifact=verifier.LOCAL/'drug_information.jsonl'
                artifact.write_bytes(('\n'.join(json.dumps(r) for r in rows)+'\n').encode())
                manifest=json.loads((LOCAL/'DRUG_INFORMATION_MANIFEST.json').read_bytes())
                manifest['output_sha256']=real_sha(artifact);manifest['output_byte_size']=artifact.stat().st_size
                (verifier.LOCAL/'DRUG_INFORMATION_MANIFEST.json').write_bytes((json.dumps(manifest)+'\n').encode())
                with self.subTest(field=field),redirect_stdout(io.StringIO()),self.assertRaisesRegex(ValueError,'Unsupported fields/content/provenance'):
                    verifier.verify()

    def test_exact_lookup_and_missing(self):
        store=EntityMetadataStore.empty().with_drug_information(LOCAL,INVENTORY)
        self.assertIsNotNone(store.get('drug','DB01050'))
        for kind,key in [('Drug','DB01050'),('drug','db01050'),('drug',' DB01050'),('drug','Ibuprofen')]:
            self.assertIsNone(store.get(kind,key))
        copy=store.get('drug','DB01050');copy['drug_information']['drug_class']='changed'
        self.assertNotEqual(store.get('drug','DB01050')['drug_information']['drug_class'],'changed')
        with tempfile.TemporaryDirectory() as folder:
            original=EntityMetadataStore.empty()
            self.assertIs(original.with_drug_information(Path(folder),INVENTORY),original)

    def test_corruption_and_rehashed_unsafe_records(self):
        original=(LOCAL/'drug_information.jsonl').read_bytes()
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder)
            path=directory/'drug_information.jsonl';manifest=directory/'DRUG_INFORMATION_MANIFEST.json'
            path.write_bytes(original)
            with self.assertRaises(FileNotFoundError):EntityMetadataStore.empty().with_drug_information(directory,INVENTORY)
            for mode in ('hash','duplicate','normalized','unsupported','unresolved_class','order'):
                rows=[json.loads(line) for line in original.splitlines()]
                if mode=='duplicate':rows[1]=rows[0]
                elif mode=='normalized':rows[0]['entity_id']=rows[0]['entity_id'].lower()
                elif mode=='unsupported':rows[0]['information']['dosage']='invented'
                elif mode=='unresolved_class':
                    r=next(r for r in rows if r['information']['mapping_status']=='unresolved')
                    r['information']['drug_class']='invented'
                elif mode=='order':rows.reverse()
                data=('\n'.join(json.dumps(r) for r in rows)+'\n').encode()
                path.write_bytes(data)
                manifest.write_text(json.dumps({'schema_version':1,'record_count':4278,
                    'output_byte_size':len(data),'output_sha256':'0'*64 if mode=='hash' else hashlib.sha256(data).hexdigest()}),encoding='utf-8')
                with self.subTest(mode=mode),self.assertRaises(ValueError):EntityMetadataStore.empty().with_drug_information(directory,INVENTORY)

    def test_ambiguous_bridge_does_not_select_first(self):
        spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/build_drug_information.py')
        builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        identity={'display_name':'Exact entity'}
        evidence={'status':'approved','facts':[{'molecule_type':'Small molecule'}],'targets':['CHEMBL1']}
        candidate={'UNII':'ABCDEFGHIJ','DISPLAY_NAME':'A','INGREDIENT_TYPE':'INGREDIENT SUBSTANCE','SUBSTANCE_TYPE':'chemical'}
        info=builder.make_information(identity,evidence,[candidate,{**candidate,'UNII':'KLMNOPQRST'}],[{'label':'Invented selection'}],[])
        self.assertIsNone(info['unii']);self.assertIsNone(info['drug_class'])
        self.assertEqual(info['active_substance'],'Exact entity')
        for kind in ('IONIC MOIETY','MOLECULAR FRAGMENT','UNSPECIFIED INGREDIENT','SPECIFIED SUBSTANCE'):
            info=builder.make_information(identity,evidence,[{**candidate,'INGREDIENT_TYPE':kind}],[{'label':'Unsafe'}],[])
            self.assertIsNone(info['unii']);self.assertIsNone(info['drug_class'])

    def test_api_acceptance_and_other_entities_unchanged(self):
        from fastapi.testclient import TestClient
        from api.main import app
        with TestClient(app) as client:
            response=client.get('/api/context/drug',params={'drug_id':'DB01050','limit':200})
            self.assertEqual(response.status_code,200)
            payload=response.json();info=payload['center']['metadata']['drug_information']
            self.assertEqual(info['drug_class'],'Nonsteroidal Anti-inflammatory Drug')
            self.assertEqual(info['general_use'],'Pain; Fever; Headache')
            self.assertEqual(info['active_substance'],'IBUPROFEN')
            lepirudin=app.state.entity_metadata_store.get('drug','DB00001')['drug_information']
            self.assertEqual(lepirudin['active_substance'],'Lepirudin')
            self.assertIsNone(lepirudin['drug_class']);self.assertIsNone(lepirudin['general_use'])
            self.assertEqual(app.state.entity_metadata_store.get('gene/protein','7498')['official_symbol'],'XDH')
            disease=app.state.entity_metadata_store.get('disease','13843')
            self.assertEqual(disease['description'],'Any meconium ileus in which the cause of the disease is a mutation in the GUCY2C gene.')
            store=app.state.neighborhood_store;original=store.entity_metadata_store
            try:
                store.entity_metadata_store=EntityMetadataStore.empty()
                plain=store.get_drug_neighborhood('DB01050',limit=200)
                self.assertEqual(plain['counts'],payload['counts'])
                self.assertEqual([r['node_id'] for r in plain['neighbors']],[r['node_id'] for r in payload['neighbors']])
            finally:store.entity_metadata_store=original

if __name__=='__main__':unittest.main()
