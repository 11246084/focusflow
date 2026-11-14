import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from gemini_multimodal_adapter import GeminiMultimodalAdapter, EmbeddingRequestError, PRICING_VERSION
from run_video1_batch import IDS, VIDEO_ID, COURSE_ID, validate_manifest, run_requests, LEDGER, CHECKPOINTS
from test_gemini_multimodal_adapter import FakeClient
from segment_media_embedding import write_json


class Video1BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ledger = self.root / 'shared-ledger.json'

    def tearDown(self):
        self.temp.cleanup()

    def adapter(self, client, output='cp'):
        return GeminiMultimodalAdapter(self.root / output, max_cost_usd=20, max_calls=1048,
            allow_paid=True, ledger_path=self.ledger, client_factory=lambda _: client, sleep=lambda _: None)

    def test_allowlist_is_exact_and_rejects_other_chunk(self):
        chunks = [dict(courseId=COURSE_ID, videoId=VIDEO_ID, chunkId=i, text='contract fixture', startSec=n*10,
                       endSec=n*10+8, media={'audio': {}, 'visual': {}}) for n, i in enumerate(IDS)]
        manifest = dict(schemaVersion='video1_manifest_v1', courseId=COURSE_ID, videoId=VIDEO_ID, ids=IDS[:], chunks=chunks)
        validate_manifest(manifest)
        manifest['chunks'][0]['chunkId'] = VIDEO_ID + '_chunk_0118'
        with self.assertRaises(ValueError):
            validate_manifest(manifest)
        self.assertIn('.local-tools/multimodal-gemini/cost-ledger.json', LEDGER.as_posix())
        self.assertIn('gemini-small-sample/gemini/checkpoints', CHECKPOINTS.as_posix())

    def test_windows_atomic_replace_retries_only_local_io(self):
        original = Path.replace
        attempts = []
        def replace(source, target):
            attempts.append(target)
            if len(attempts) < 3:
                raise PermissionError('temporary scanner lock')
            return original(source, target)
        target = self.root / 'atomic.json'
        with patch.object(Path, 'replace', autospec=True, side_effect=replace), patch('segment_media_embedding.time.sleep') as sleep:
            write_json(target, {'status': 'durable'})
        self.assertEqual(json.loads(target.read_text()), {'status': 'durable'})
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(list(self.root.glob('*.tmp')), [])

    def test_twenty_dollar_shared_budget_blocks_retries_and_restart_before_sdk(self):
        self.ledger.write_text(json.dumps(dict(calls=0, reservedUsd=19.996, pricingVersion=PRICING_VERSION)))
        rate = type('RateLimit', (Exception,), {'code': 429})
        client = FakeClient(failures=[rate(), rate(), rate()])
        with self.assertRaises(PermissionError):
            self.adapter(client).embed_text('budget fixture', role='text')
        self.assertEqual(len(client.calls), 2)
        later = FakeClient()
        with self.assertRaises(PermissionError):
            self.adapter(later, 'different-output').embed_text('budget fixture', role='text')
        self.assertEqual(later.calls, [])
        self.assertLessEqual(json.loads(self.ledger.read_text())['reservedUsd'], 20)

    def test_interrupted_attempt_and_restarts_cannot_reset_three_attempts(self):
        first = FakeClient(failures=[KeyboardInterrupt()])
        with self.assertRaises(KeyboardInterrupt):
            self.adapter(first).embed_text('interruption fixture', role='text')
        rate = type('RateLimit', (Exception,), {'code': 429})
        second = FakeClient(failures=[rate(), rate(), rate()])
        with self.assertRaises(EmbeddingRequestError):
            self.adapter(second, 'restart').embed_text('interruption fixture', role='text')
        self.assertEqual(len(first.calls) + len(second.calls), 3)
        last = FakeClient()
        with self.assertRaises(EmbeddingRequestError):
            self.adapter(last, 'third-output').embed_text('interruption fixture', role='text')
        self.assertEqual(last.calls, [])

    def test_success_checkpoint_and_batch_state_are_reusable_not_another_paid_attempt(self):
        request = {'kind': 'text', 'identity': dict(courseId=COURSE_ID, videoId=VIDEO_ID, chunkId=IDS[0], startSec=0, endSec=8),
                   'text': 'contract fixture'}
        # Three requests model a batch; identity is still passed through the real adapter.
        requests = [request] * 3
        client = FakeClient()
        for _ in range(2):
            state = run_requests(requests, self.adapter(client), self.root / 'state', manifest_hash='frozen', batch_size=1)
        self.assertEqual(len(client.calls), 1)
        self.assertTrue(state['results'][IDS[0]+':text']['reused'])
        with self.assertRaises(ValueError):
            run_requests(requests, self.adapter(client), self.root / 'state', manifest_hash='changed', batch_size=1)


if __name__ == '__main__':
    unittest.main()
