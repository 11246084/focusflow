import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from evaluation_embedding_batch import run_batch, input_signature, inspect_checkpoints
from run_video1_batch import BatchAdapter, stop_retry
from run_gemini_validation import FakeSDK

class EvaluationBatchTests(unittest.TestCase):
    def native_checkpoint(self, row):
        import hashlib
        from embedding_contract import (GEMINI_EMBEDDING_CONTRACT_VERSION as contract,
            GEMINI_EMBEDDING_INSTRUCTION_VERSION as instruction,
            GEMINI_EMBEDDING_GENERATION_VERSION as generation,
            GEMINI_EMBEDDING_NORMALIZATION_VERSION as normalization)
        values = [1.0] + [0.0] * 3071
        return {'signature': input_signature(row), 'provider': 'gemini', 'model': 'gemini-embedding-2',
            'dimension': 3072, 'status': 'success', 'modality': row['role'], 'embedding': values,
            'embeddingDigest': hashlib.sha256(json.dumps(values).encode()).hexdigest(),
            'contractVersion': contract, 'schemaVersion': contract, 'instructionVersion': instruction,
            'generationVersion': generation, 'normalizationVersion': normalization, 'taskType': None,
            **(row['identity'] or {})}

    def test_readonly_inventory_separates_missing_blocked_and_valid_without_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); spec = self.spec(); row = spec['rows'][0]
            cp = self.native_checkpoint(row); path = root/(cp['signature']+'.json')
            path.write_text(json.dumps(cp), encoding='utf-8'); before = path.read_bytes()
            ledger = {'attemptsBySignature': {input_signature(spec['rows'][1]): 1}}
            report = inspect_checkpoints(spec, root, ledger)
            self.assertEqual((report['reusable'], report['missing'], report['blocked']), (1, 1, 1))
            self.assertEqual(report['apiCalls'], 0); self.assertEqual(path.read_bytes(), before)
            self.assertEqual(len(list(root.iterdir())), 1)

    def test_inventory_rejects_fake_contract_identity_and_vector_corruption(self):
        from copy import deepcopy
        row = self.spec()['rows'][0]
        row['identity'] = {'courseId': 'c', 'videoId': 'v', 'chunkId': 'parent', 'startSec': 1, 'endSec': 2}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); cp = self.native_checkpoint(row)
            for key, value in [('provider', 'fake-sdk'), ('generationVersion', 'old'),
                               ('videoId', 'other'), ('embeddingDigest', 'bad'), ('dimension', 3),
                               ('embedding', [float('nan')]*3072)]:
                bad = deepcopy(cp); bad[key] = value
                (root/(cp['signature']+'.json')).write_text(json.dumps(bad), encoding='utf-8')
                report = inspect_checkpoints({'rows': [row]}, root, {})
                self.assertEqual(report['reusable'], 0, key)
                self.assertEqual(report['blocked'], 1, key)

    def test_input_digest_and_parent_identity_are_bound_to_signature(self):
        row = self.spec()['rows'][0]
        original = input_signature(row)
        self.assertNotEqual(original, input_signature({**row, 'identity': {'chunkId': 'different'}}))
        self.assertNotEqual(original, input_signature(row, 'fake-sdk'))
        with self.assertRaises(ValueError): input_signature({**row, 'inputSha256': 'bad'})

    def test_export_missing_cache_is_readonly_and_chinese_plan_uses_utf8(self):
        import hashlib
        from unittest.mock import patch
        from evaluation_embedding_batch import main
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); directory = root/'.local-tools/export'; directory.mkdir(parents=True)
            spec = self.spec(); spec['rows'][0]['text'] = '中文題目'
            plan_file = directory/'plan.json'; plan_file.write_text(json.dumps(spec, ensure_ascii=False), encoding='utf-8')
            digest = hashlib.sha256(plan_file.read_bytes()).hexdigest()
            state = {'planHash': hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest(),
                     'mode': 'gemini', 'results': {r['id']: {'status': 'success', 'signature': input_signature(r)} for r in spec['rows']}}
            (directory/'state.json').write_text(json.dumps(state), encoding='utf-8')
            ledger = root/'ledger.json'; ledger.write_text('{"calls": 2088}', encoding='utf-8')
            before = {p: p.read_bytes() for p in root.rglob('*.json')}
            args = ['batch', '--kind', 'query', '--directory', str(directory), '--mode', 'export', '--approve-plan', digest]
            with patch('evaluation_embedding_batch.ROOT', root), patch('evaluation_embedding_batch.LEDGER', ledger), \
                 patch('evaluation_embedding_batch.CHECKPOINTS', root/'cache'), patch('evaluation_embedding_batch.plan', return_value=spec), \
                 patch('sys.argv', args):
                with self.assertRaisesRegex(ValueError, 'complete valid native'): main()
            self.assertEqual(before, {p: p.read_bytes() for p in root.rglob('*.json')})

    def test_export_complete_native_cache_keeps_ledger_and_vectors_unchanged(self):
        import hashlib
        from unittest.mock import patch
        from evaluation_embedding_batch import main
        from gemini_multimodal_adapter import PRICING_VERSION
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); directory = root/'.local-tools/export'; directory.mkdir(parents=True)
            cache = root/'cache'; cache.mkdir(); spec = {**self.spec(), 'bankSha256': 'fixture-bank'}
            plan_file = directory/'plan.json'; plan_file.write_text(json.dumps(spec), encoding='utf-8')
            state = {'planHash': hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest(),
                     'mode': 'gemini', 'results': {}}
            for row in spec['rows']:
                cp = self.native_checkpoint(row)
                (cache/(cp['signature']+'.json')).write_text(json.dumps(cp), encoding='utf-8')
                state['results'][row['id']] = {'status': 'success', 'signature': cp['signature']}
            (directory/'state.json').write_text(json.dumps(state), encoding='utf-8')
            ledger = root/'ledger.json'
            ledger.write_text(json.dumps({'pricingVersion': PRICING_VERSION, 'calls': 2088, 'reservedUsd': 10.55589788}), encoding='utf-8')
            before = {p: p.read_bytes() for p in root.rglob('*.json')}
            args = ['batch', '--kind', 'query', '--directory', str(directory), '--mode', 'export',
                    '--approve-plan', hashlib.sha256(plan_file.read_bytes()).hexdigest()]
            with patch('evaluation_embedding_batch.ROOT', root), patch('evaluation_embedding_batch.LEDGER', ledger), \
                 patch('evaluation_embedding_batch.CHECKPOINTS', cache), patch('evaluation_embedding_batch.plan', return_value=spec), \
                 patch('sys.argv', args): main()
            bundle = json.loads((directory/'bundle.json').read_text(encoding='utf-8'))
            self.assertEqual(len(bundle['records']), 3)
            self.assertTrue(all(r['metadata']['reused'] for r in bundle['records']))
            self.assertTrue(all(p.read_bytes() == data for p, data in before.items()))

    def adapter(self, root, sdk, maximum=20):
        return BatchAdapter(root/'cp', max_cost_usd=maximum, max_calls=20, allow_paid=True,
            execution_mode='fake-sdk', ledger_path=root/'shared.json', client_factory=lambda _:sdk, sleep=stop_retry)

    def spec(self, role='query'):
        return {'rows':[{'id':str(i),'text':'question '+str(i),'role':role,'identity':None}
                        for i in range(3)]}

    def test_query_subset_resume_and_parent_share_ledger(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sdk=FakeSDK();a=self.adapter(root,sdk)
            spec=self.spec();run_batch(spec,a,root/'query',ids=['1'],pause=lambda _:None)
            self.assertEqual(len(sdk.calls),1)
            run_batch(spec,a,root/'query',limit=1,pause=lambda _:None)
            self.assertEqual(len(sdk.calls),2)
            run_batch(spec,a,root/'query',pause=lambda _:None)
            self.assertEqual(len(sdk.calls),3)
            run_batch(spec,a,root/'query',pause=lambda _:None)
            self.assertEqual(len(sdk.calls),3)
            run_batch(self.spec('text'),a,root/'parent',pause=lambda _:None)
            ledger=json.loads((root/'shared.json').read_text())
            self.assertEqual(ledger['calls'],6)
            self.assertGreater(ledger['reservedUsd'],0)

    def test_lost_success_and_scope_change_never_regenerate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sdk=FakeSDK();a=self.adapter(root,sdk);spec=self.spec()
            state=run_batch(spec,a,root/'query',ids=['0'],pause=lambda _:None)
            (root/'cp'/(state['results']['0']['signature']+'.json')).unlink()
            with self.assertRaises(PermissionError):run_batch(spec,a,root/'query',ids=['0'],pause=lambda _:None)
            changed=self.spec();changed['rows'][0]['text']='changed'
            with self.assertRaises(ValueError):run_batch(changed,a,root/'query',pause=lambda _:None)
            self.assertEqual(len(sdk.calls),1)

    def test_budget_stop_retains_prior_reserve_and_unknown_ids_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sdk=FakeSDK();a=self.adapter(root,sdk,.002)
            with self.assertRaises(PermissionError):run_batch(self.spec(),a,root/'query',pause=lambda _:None)
            self.assertEqual(len(sdk.calls),1)
            self.assertEqual(json.loads((root/'shared.json').read_text())['calls'],1)
            with self.assertRaises(ValueError):run_batch(self.spec(),a,root/'query',ids=['missing'],pause=lambda _:None)

    def test_legacy_parent_default_uses_shared_adapter_and_ceiling(self):
        from unittest.mock import patch, MagicMock
        from types import SimpleNamespace
        from parent_embedding import _default_provider
        with tempfile.TemporaryDirectory() as tmp:
            ledger=Path(tmp)/'ledger.json';ledger.write_text('{}')
            adapter=MagicMock();adapter.embed_text.return_value={'embedding':[1.0]}
            config=SimpleNamespace(gemini_embedding_model_name='gemini-embedding-2',gemini_embedding_output_dim=3072)
            with patch('run_video1_batch.LEDGER',ledger), patch('run_video1_batch.BatchAdapter',return_value=adapter) as factory:
                values,ids=_default_provider(['Parent original text'],config)
                self.assertEqual(values,[[1.0]])
                self.assertEqual(factory.call_args.kwargs['max_cost_usd'],20)
                self.assertEqual(factory.call_args.kwargs['ledger_path'],ledger)
                adapter.embed_text.assert_called_once_with('Parent original text',role='text')

    def test_default_parent_stops_before_next_parent_on_unknown_failure(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        from parent_embedding import embed_parent_chunks, ParentEmbeddingStageError
        config=SimpleNamespace(parent_embeddings_output_path=Path('unused'))
        parents=[SimpleNamespace(parent_id='p1',text='first'),SimpleNamespace(parent_id='p2',text='second')]
        with patch('parent_embedding._load_checkpoint',return_value={}), patch('parent_embedding._default_provider',side_effect=TimeoutError()) as provider:
            with self.assertRaises(ParentEmbeddingStageError):
                embed_parent_chunks(parents,config,'hierarchy','source','embedding')
            self.assertEqual(provider.call_count,1)

    def test_provider_failure_stops_without_retry_and_preserves_ledger(self):
        class Failed:
            calls=0
            @property
            def models(self):return self
            def embed_content(self,**kw):
                self.calls+=1
                raise TimeoutError()
            def close(self):pass
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sdk=Failed();a=self.adapter(root,sdk)
            with self.assertRaises(PermissionError):run_batch(self.spec(),a,root/'query',pause=lambda _:None)
            with self.assertRaises(PermissionError):run_batch(self.spec(),a,root/'query',pause=lambda _:None)
            self.assertEqual(sdk.calls,1)
            self.assertEqual(json.loads((root/'shared.json').read_text())['calls'],1)

if __name__=='__main__':unittest.main()
