"""Runtime safety and API integration tests, using temporary copies for corruption."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import importlib.util
import shutil
from contextlib import redirect_stdout
import io

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.entity_metadata import EntityMetadataStore

RUNTIME = ROOT / 'final_release/entity_metadata_runtime'

class DescriptionTests(unittest.TestCase):
    def load_diseases(self):
        return EntityMetadataStore.load_descriptions(RUNTIME / 'disease_descriptions.jsonl',
            RUNTIME / 'DISEASE_DESCRIPTIONS_MANIFEST.json',
            RUNTIME / 'entity_description_inventory.jsonl', ROOT)

    def test_exact_lookup_and_copy(self):
        store = self.load_diseases()
        self.assertEqual(len(store), 2010)
        item = store.get('disease', '13843')
        self.assertIsNotNone(item['description'])
        item['description'] = 'changed'
        self.assertNotEqual(store.get('disease', '13843')['description'], 'changed')
        for kind, identity in [('Disease','13843'),('disease',' 13843'),('disease','13843 '),
                               ('disease','MONDO:0013843'),('disease','intestinal obstruction')]:
            self.assertIsNone(store.get(kind, identity))

    def test_missing_bundle_and_corruption(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            artifact, manifest = root / 'disease_descriptions.jsonl', root / 'manifest.json'
            inventory = RUNTIME / 'entity_description_inventory.jsonl'
            self.assertFalse(EntityMetadataStore.load_descriptions(artifact, manifest, inventory, root).enabled)
            original = (RUNTIME / 'disease_descriptions.jsonl').read_bytes()
            artifact.write_bytes(original)
            with self.assertRaises(FileNotFoundError):
                EntityMetadataStore.load_descriptions(artifact, manifest, inventory, root)
            def pin(data):
                artifact.write_bytes(data)
                manifest.write_text(json.dumps({'outputs':{artifact.name:{'byte_size':len(data),
                    'sha256':hashlib.sha256(data).hexdigest(),'record_count':2010}}}),encoding='utf-8')
            pin(original)
            artifact.write_bytes(original + b' ')
            with self.assertRaises(ValueError):
                EntityMetadataStore.load_descriptions(artifact, manifest, inventory, root)
            for mutation in ('duplicate','grouped_definition','review_definition','extra_field','normalized_id','reordered'):
                rows = [json.loads(line) for line in original.splitlines()]
                if mutation == 'duplicate': rows[1] = rows[0]
                elif mutation == 'grouped_definition':
                    rows[0]['metadata']['description'] = 'Invented definition'
                    rows[0]['metadata']['status'] = 'approved'
                elif mutation == 'review_definition': rows[0]['metadata']['description'] = 'Unsafe'
                elif mutation == 'extra_field': rows[0]['metadata']['indication'] = 'Unsupported'
                elif mutation == 'normalized_id': rows[0]['entity_id'] = ' ' + rows[0]['entity_id']
                else: rows.reverse()
                pin(('\n'.join(json.dumps(r) for r in rows)+'\n').encode())
                with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                    EntityMetadataStore.load_descriptions(artifact, manifest, inventory, root)

    def test_gene_behavior_and_duplicate_merge(self):
        gene = EntityMetadataStore.load(RUNTIME / 'gene_metadata.jsonl')
        combined = gene.combined(self.load_diseases())
        self.assertEqual(gene.get('gene/protein','7498'), combined.get('gene/protein','7498'))
        with self.assertRaises(ValueError): combined.combined(gene)

    def test_independent_verifier_rejects_rehashed_invention(self):
        spec = importlib.util.spec_from_file_location('description_verifier', ROOT / 'final_release/verify_entity_descriptions.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        with tempfile.TemporaryDirectory() as temp:
            verifier.ROOT = Path(temp)
            verifier.RUNTIME = Path(temp) / 'final_release/entity_metadata_runtime'
            verifier.LOCAL = Path(temp) / 'absent'
            verifier.RUNTIME.mkdir(parents=True)
            for name in ('entity_description_inventory.jsonl','disease_source_mapping.jsonl',
                         'disease_descriptions.jsonl','DISEASE_DESCRIPTIONS_MANIFEST.json'):
                shutil.copyfile(RUNTIME / name, verifier.RUNTIME / name)
            with redirect_stdout(io.StringIO()): verifier.verify()
            artifact = verifier.RUNTIME / 'disease_descriptions.jsonl'
            original = artifact.read_bytes()
            manifest_path = verifier.RUNTIME / 'DISEASE_DESCRIPTIONS_MANIFEST.json'
            for mutation in ('invented','grouped','identity','order','provenance'):
                data = [json.loads(line) for line in original.splitlines()]
                if mutation == 'invented': data[1]['metadata']['description'] = 'An invented scientific statement.'
                elif mutation == 'grouped':
                    data[0]['metadata']['description'] = 'An invented grouped definition.'
                    data[0]['metadata']['status'] = 'approved'
                elif mutation == 'identity': data[1]['entity_id'] = '013843'
                elif mutation == 'order': data.reverse()
                else: data[1]['metadata']['source'] = 'Other source'
                artifact.write_bytes(('\n'.join(json.dumps(r) for r in data)+'\n').encode())
                manifest = json.loads(manifest_path.read_bytes())
                manifest['outputs']['final_release/entity_metadata_runtime/disease_descriptions.jsonl'].update(verifier.digest(artifact))
                manifest_path.write_bytes((json.dumps(manifest, indent=2, sort_keys=True)+'\n').encode('utf-8'))
                with self.subTest(mutation=mutation), self.assertRaises(ValueError): verifier.verify()

    def test_api_center_neighbors_and_fallback(self):
        from fastapi.testclient import TestClient
        from api.main import app
        with TestClient(app) as client:
            response = client.get('/api/context/drug', params={'drug_id':'DB00180', 'limit':200})
            self.assertEqual(response.status_code,200, response.text)
            payload = response.json()
            self.assertEqual(payload['center']['metadata'], app.state.entity_metadata_store.get('drug','DB00180'))
            for node in payload['neighbors']:
                self.assertEqual(node.get('metadata'), app.state.entity_metadata_store.get(node['entity_type'],node['entity_id']))
            self.assertIsNotNone(payload['center']['metadata']['description'])
            store = app.state.neighborhood_store
            original = store.entity_metadata_store
            try:
                store.entity_metadata_store = EntityMetadataStore.empty()
                fallback = store.get_drug_neighborhood('DB00180',limit=200)
                self.assertIsNone(fallback['center']['metadata'])
                self.assertEqual(fallback['counts'],payload['counts'])
                self.assertEqual([r['node_id'] for r in fallback['neighbors']], [r['node_id'] for r in payload['neighbors']])
            finally:
                store.entity_metadata_store = original

if __name__ == '__main__':
    unittest.main()
