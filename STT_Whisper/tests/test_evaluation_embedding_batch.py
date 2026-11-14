import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from evaluation_embedding_batch import run_batch
from run_video1_batch import BatchAdapter, stop_retry
from run_gemini_validation import FakeSDK

class EvaluationBatchTests(unittest.TestCase):
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
