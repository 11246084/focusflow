import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from multimodal_corpus import CATALOG, ids_for, validate_scope
from run_video1_batch import BatchAdapter, run_requests, stop_retry, query_request
from gemini_multimodal_adapter import GeminiMultimodalAdapter, EmbeddingRequestError
from test_gemini_multimodal_adapter import FakeClient


class CorpusBatchTests(unittest.TestCase):
    def test_fourth_attempt_is_exact_single_use_and_preserves_history(self):
        for fails in (False, True):
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); ledger = root/'shared.json'; cp = root/'cp'
                rate = type('RateLimit', (Exception,), {'code': 429})
                initial = FakeClient(failures=[rate(), rate(), rate()])
                def adapter(cls, client, **extra):
                    return cls(cp, max_cost_usd=20, max_calls=100, allow_paid=True,
                        ledger_path=ledger, client_factory=lambda _: client, sleep=lambda _: None, **extra)
                with self.assertRaises(EmbeddingRequestError):
                    adapter(GeminiMultimodalAdapter, initial).embed_text('exact fourth fixture', role='text')
                file = next(cp.glob('*.json')); prior = json.loads(file.read_text()); sig = prior['signature']
                before = json.loads(ledger.read_text())
                denied = FakeClient()
                with self.assertRaises(PermissionError):
                    adapter(BatchAdapter, denied, retry_signature=sig, retry_attempt=4).embed_text('exact fourth fixture', role='text')
                with self.assertRaises(PermissionError):
                    adapter(BatchAdapter, denied, retry_signature='0'*64, retry_attempt=4,
                        extra_retry_signature='0'*64).embed_text('exact fourth fixture', role='text')
                self.assertEqual(denied.calls, [])
                retry = FakeClient(failures=[rate()] if fails else [])
                authorized = adapter(BatchAdapter, retry, retry_signature=sig, retry_attempt=4, extra_retry_signature=sig)
                if fails:
                    with self.assertRaises(EmbeddingRequestError):
                        authorized.embed_text('exact fourth fixture', role='text')
                    with self.assertRaises(PermissionError):
                        authorized.embed_text('exact fourth fixture', role='text')
                else:
                    self.assertEqual(authorized.embed_text('exact fourth fixture', role='text')['status'], 'success')
                    self.assertTrue(authorized.embed_text('exact fourth fixture', role='text')['reused'])
                self.assertEqual(len(retry.calls), 1)
                after = json.loads(ledger.read_text())
                self.assertEqual(after['calls'], before['calls'] + 1)
                self.assertGreater(after['reservedUsd'], before['reservedUsd'])
                self.assertEqual(after['attemptsBySignature'][sig], 4)
                permit = json.loads((root/'controlled-retry-permits'/f'{sig}-4.json').read_text())
                self.assertEqual(permit['beforeCheckpoint'], prior)
                self.assertEqual(permit['beforeLedgerCalls'], 3)
                self.assertEqual(authorized._attempt_limit('0'*64), 3)
                # New output paths cannot bypass consumed permits / ledger history.
                with self.assertRaises(PermissionError):
                    BatchAdapter(root/'different', retry_signature=sig, retry_attempt=4, extra_retry_signature=sig,
                        max_cost_usd=20, allow_paid=True, ledger_path=ledger,
                        client_factory=lambda _: denied).embed_text('exact fourth fixture', role='text')
                self.assertEqual(denied.calls, [])

    def test_extra_retry_configuration_and_budget_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for signature, attempt in [('bad', 4), ('0'*64, 3), ('1'*64, 4)]:
                with self.assertRaises(ValueError):
                    BatchAdapter(root/'cp', max_cost_usd=20, retry_signature='0'*64,
                        retry_attempt=attempt, extra_retry_signature=signature)
            ledger = root/'shared.json'
            ledger.write_text(json.dumps({'calls':0,'reservedUsd':20,'pricingVersion':'google_standard_2026-11-10'}))
            client = FakeClient()
            adapter = BatchAdapter(root/'cp', max_cost_usd=20, allow_paid=True, ledger_path=ledger,
                retry_signature='0'*64, retry_attempt=4, extra_retry_signature='0'*64,
                client_factory=lambda _:client)
            with self.assertRaises(PermissionError):
                adapter.embed_text('budget fixture', role='text')
            self.assertEqual(client.calls, [])
            self.assertEqual(json.loads(ledger.read_text())['reservedUsd'],20)

    def test_query_plan_uses_existing_bank_question_and_real_time_anchor_without_changing_gold(self):
        spec = CATALOG['videos'][1]
        manifest = {'videoId': spec['videoId'], 'courseId': CATALOG['courseId'], 'chunks': [
            {'courseId': CATALOG['courseId'], 'videoId': spec['videoId'], 'chunkId': ids_for(spec)[0],
             'startSec': 462, 'endSec': 480, 'text': 'Synthetic contract fixture'}]}
        request = query_request(manifest)
        self.assertEqual(request['questionId'], 'F06')
        self.assertEqual(request['identity']['startSec'], 462)
        with self.assertRaises(ValueError):
            query_request(manifest, 'X01')
        with self.assertRaises(ValueError):
            query_request(manifest, 'F01')

    def test_all_five_scopes_have_exact_ids_and_two_skipped_media_pairs(self):
        targets = inputs = skipped = 0
        for spec in CATALOG['videos'][1:]:
            chunks = []
            for index, chunk_id in enumerate(ids_for(spec)):
                skip = chunk_id in spec['skipMediaIds']
                chunks.append(dict(courseId=CATALOG['courseId'], videoId=spec['videoId'], chunkId=chunk_id,
                    startSec=index*10, endSec=index*10+(61 if skip else 8), text='Synthetic contract fixture',
                    media={} if skip else {'audio': {}, 'visual': {}}, **({'skipMediaReason': 'duration_over_60s'} if skip else {})))
            manifest = dict(schemaVersion='video_manifest_v1', courseId=CATALOG['courseId'], ids=ids_for(spec), chunks=chunks,
                **{k: spec[k] for k in ['videoId', 'sourceSha256', 'artifactSha256', 'durationSec']})
            validate_scope(manifest)
            targets += len(chunks); inputs += sum(1 + len(c['media']) for c in chunks); skipped += len(spec['skipMediaIds'])
            manifest['chunks'][0]['videoId'] = CATALOG['videos'][0]['videoId']
            with self.assertRaises(ValueError):
                validate_scope(manifest)
        self.assertEqual((targets, inputs, skipped), (577, 1727, 2))

    def test_chunk_batching_handles_a_text_only_chunk_without_consuming_next_chunk(self):
        class Adapter:
            execution_mode = 'fake-sdk'
            calls = []
            def embed_text(self, text, *, role, identity):
                self.calls.append(identity['chunkId'])
                return {'status': 'success', 'signature': 'synthetic', 'reused': False}
            def embed_media(self, _):
                raise AssertionError('Text-only batch cannot request media')
        requests = []
        for chunk, kinds in [('one', ['text', 'audio', 'visual']), ('long', ['text']), ('three', ['text', 'audio', 'visual'])]:
            for kind in kinds:
                requests.append({'identity': {'chunkId': chunk}, 'kind': kind, 'text': 'contract fixture'})
        with tempfile.TemporaryDirectory() as directory:
            a = Adapter()
            state = run_requests(requests, a, Path(directory), manifest_hash='frozen', start=1, batch_size=1)
            self.assertEqual(a.calls, ['long']); self.assertEqual(len(state['results']), 1)

    def test_failed_unknown_input_cannot_be_retried_by_restart_or_new_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); ledger = root / 'shared.json'
            first = FakeClient(failures=[TimeoutError('redacted')])
            a = BatchAdapter(root/'first', max_cost_usd=20, max_calls=CATALOG['maxCalls'], allow_paid=True,
                ledger_path=ledger, client_factory=lambda _: first, sleep=stop_retry)
            with self.assertRaises(PermissionError):
                a.embed_text('contract fixture', role='text')
            second = FakeClient()
            b = BatchAdapter(root/'different', max_cost_usd=20, max_calls=CATALOG['maxCalls'], allow_paid=True,
                ledger_path=ledger, client_factory=lambda _: second, sleep=stop_retry)
            with self.assertRaises(PermissionError):
                b.embed_text('contract fixture', role='text')
            self.assertEqual(len(first.calls), 1); self.assertEqual(second.calls, [])
            self.assertEqual(json.loads(ledger.read_text())['calls'], 1)

    def test_known_success_with_missing_cache_is_not_regenerated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); client = FakeClient()
            a = BatchAdapter(root/'cache', known_successes={'chunk:text'}, max_cost_usd=20, max_calls=CATALOG['maxCalls'],
                allow_paid=True, ledger_path=root/'ledger.json', client_factory=lambda _: client)
            with self.assertRaises(PermissionError):
                a.embed_text('contract fixture', role='text', identity={'courseId': 'c', 'videoId': 'v', 'chunkId': 'chunk', 'startSec': 0, 'endSec': 8})
            self.assertEqual(client.calls, [])

    def test_exact_retry_permit_allows_only_one_additional_attempt_and_preserves_unknown_preimage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); ledger = root/'shared.json'; client = FakeClient(failures=[TimeoutError()])
            a = BatchAdapter(root/'cp', max_cost_usd=20, max_calls=CATALOG['maxCalls'], allow_paid=True,
                ledger_path=ledger, client_factory=lambda _: client, sleep=stop_retry)
            with self.assertRaises(PermissionError):
                a.embed_text('contract fixture', role='text')
            checkpoint = next((root/'cp').glob('*.json')); failed = json.loads(checkpoint.read_text())
            retry = FakeClient()
            b = BatchAdapter(root/'cp', retry_signature=failed['signature'], retry_attempt=2,
                max_cost_usd=20, max_calls=CATALOG['maxCalls'], allow_paid=True, ledger_path=ledger,
                client_factory=lambda _: retry, sleep=stop_retry)
            self.assertEqual(b.embed_text('contract fixture', role='text')['status'], 'success')
            self.assertTrue(b.embed_text('contract fixture', role='text')['reused'])
            self.assertEqual(len(retry.calls), 1); self.assertEqual(json.loads(ledger.read_text())['calls'], 2)
            permit = json.loads(next((root/'controlled-retry-permits').glob('*.json')).read_text())
            self.assertEqual(permit['beforeCheckpoint']['status'], 'failed')
            self.assertEqual(permit['beforeCheckpoint']['attempts'], 1)

    def test_corrupt_success_signature_does_not_trigger_a_new_provider_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); client = FakeClient()
            a = BatchAdapter(root/'cp', max_cost_usd=20, max_calls=CATALOG['maxCalls'], allow_paid=True,
                ledger_path=root/'ledger.json', client_factory=lambda _: client, sleep=stop_retry)
            a.embed_text('contract fixture', role='text')
            checkpoint = next((root/'cp').glob('*.json')); corrupt = json.loads(checkpoint.read_text())
            corrupt['signature'] = '0'*64; checkpoint.write_text(json.dumps(corrupt))
            with self.assertRaises(ValueError):
                a.embed_text('contract fixture', role='text')
            self.assertEqual(len(client.calls), 1)


if __name__ == '__main__':
    unittest.main()
