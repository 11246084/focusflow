import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import export_atlas_sample_bundle as exporter


class ExportTests(unittest.TestCase):
    def fixture(self, root):
        work = root / '.local-tools/gemini-small-sample/gemini'
        (work / 'checkpoints').mkdir(parents=True)
        requests, rows = [], []
        for i in range(3):
            for kind in ('query', 'text', 'audio', 'visual'):
                identity = dict(courseId='course', videoId='video', chunkId=f'chunk{i}', startSec=10, endSec=20)
                request = dict(requestId=f'{i}:{kind}', kind=kind, identity=identity, text='sample')
                signature_identity = identity.copy()
                record = dict(status='success', provider='gemini', model='gemini-embedding-2', dimension=3072,
                              modality=kind, contractVersion=f'test_{kind}', **identity)
                if kind in ('query', 'text'):
                    data = exporter.build_text_content('sample', kind).encode()
                else:
                    media = root / f'{i}-{kind}.bin'
                    media.write_bytes(b'realistic mock bytes')
                    data = media.read_bytes()
                    request['mediaRecord'] = dict(mediaPath=str(media), sampleStartSec=10, sampleEndSec=20)
                    request['input'] = dict(durationSec=10)
                    signature_identity.update(sampleStartSec=10, sampleEndSec=20, mediaDurationSec=10)
                    record.update(sampleStartSec=10, sampleEndSec=20, mediaDurationSec=10)
                signature = hashlib.sha256(json.dumps(['gemini', record['model'], 3072, kind,
                    record['contractVersion'], signature_identity, hashlib.sha256(data).hexdigest()], sort_keys=True).encode()).hexdigest()
                vector = [1.0] + [0.0] * 3071
                record.update(signature=signature, embedding=vector,
                              embeddingDigest=hashlib.sha256(json.dumps(vector).encode()).hexdigest())
                (work / 'checkpoints' / f'{signature}.json').write_text(json.dumps(record), encoding='utf8')
                requests.append(request)
                rows.append(dict(requestId=request['requestId'], signature=signature))
        (work / 'state.json').write_text(json.dumps(dict(status='success', executionMode='gemini', results=rows)), encoding='utf8')
        return requests, work, rows

    def test_export_checks_native_digests_and_emits_float64_hash_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            requests, _, _ = self.fixture(root)
            with patch.object(exporter, 'prepare_requests', return_value=(requests, {})):
                result = exporter.export_bundle(root, root / 'bundle.json')
            self.assertEqual(result['records'], 12)
            self.assertEqual(result['apiCalls'], 0)
            self.assertEqual(len(json.loads((root / 'bundle.json').read_text())['records'][0]['vectorDigest']), 64)

    def test_tampered_checkpoint_and_changed_source_fail_closed(self):
        for tamper in ('vector', 'source'):
            with self.subTest(tamper=tamper), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                requests, work, rows = self.fixture(root)
                if tamper == 'vector':
                    file = work / 'checkpoints' / f"{rows[0]['signature']}.json"
                    record = json.loads(file.read_text())
                    record['embedding'] = [0.0, 1.0] + [0.0] * 3070
                    file.write_text(json.dumps(record))
                else:
                    requests[0]['text'] = 'changed transcript'
                with patch.object(exporter, 'prepare_requests', return_value=(requests, {})):
                    with self.assertRaises(ValueError):
                        exporter.export_bundle(root, root / 'bundle.json')
                self.assertFalse((root / 'bundle.json').exists())
