"""Scope-locked evaluation Query/Parent batches; default is free planning only."""
import argparse
import hashlib
import json
import time
import struct
from pathlib import Path
from run_video1_batch import ROOT, LEDGER, CHECKPOINTS, CATALOG, BatchAdapter, stop_retry
from gemini_multimodal_adapter import estimate_cost, build_text_content
from build_parent_chunk_artifact import load_leaf_chunks
from hierarchy_chunking import build_parent_chunks
from run_gemini_validation import FakeSDK, file_digest
from segment_media_embedding import write_json


def plan(kind):
    rows = []
    bank_path = ROOT / 'docs/04_Features/QA_Evaluation/datasets/question-bank.json'
    bank = json.loads(bank_path.read_text(encoding='utf-8'))
    if bank['courseId'] != CATALOG['courseId'] or len(bank['questions']) != 50:
        raise ValueError('Unexpected Gold bank scope')
    if kind == 'query':
        rows = [{'id': q['id'], 'role': 'query', 'text': q['question'], 'identity': None}
                for q in bank['questions']]
    elif kind == 'parent':
        for spec in CATALOG['videos']:
            leaf = ROOT / 'STT_Whisper/data/outputs/runs' / spec['run'] / 'embeddings_text_gemini.jsonl'
            if file_digest(leaf) != spec['artifactSha256']:
                raise ValueError('Frozen Leaf source artifact changed')
            for p in build_parent_chunks(load_leaf_chunks(leaf, spec['videoId']), 3, 0):
                rows.append({'id': p.parent_id, 'role': 'text', 'text': p.text,
                    'identity': {'courseId': bank['courseId'], 'videoId': p.video_id,
                        'chunkId': p.parent_id, 'startSec': p.start_sec, 'endSec': p.end_sec},
                    'parent': p.to_dict(), 'sourceLeafSha256': file_digest(leaf)})
    else:
        raise ValueError('Unknown batch kind')
    for row in rows:
        row['inputSha256'] = hashlib.sha256(build_text_content(row['text'], row['role']).encode()).hexdigest()
    return {'schemaVersion': 'evaluation_batch_v1', 'kind': kind, 'bankSha256': file_digest(bank_path),
            'model': 'gemini-embedding-2', 'dimension': 3072, 'rows': rows,
            'firstAttemptReserveUsd': len(rows) * estimate_cost('text')}


def run_batch(spec, adapter, directory, *, ids=None, limit=10, pause=time.sleep):
    if not isinstance(limit, int) or not 1 <= limit <= 50:
        raise ValueError('Batch limit must be 1..50')
    selected = spec['rows'] if ids is None else [r for r in spec['rows'] if r['id'] in ids]
    if not selected or ids is not None and set(ids) != {r['id'] for r in selected}:
        raise ValueError('Unknown or empty IDs')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / 'batch.lock'
    with lock.open('x') as handle:
        handle.write('Inspect interrupted batch before releasing lock')
    try:
        digest = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        state_file = directory / 'state.json'
        state = json.loads(state_file.read_text()) if state_file.exists() else {
            'planHash': digest, 'mode': adapter.execution_mode, 'results': {}}
        if state['planHash'] != digest or state['mode'] != adapter.execution_mode:
            raise ValueError('Checkpoint scope changed')
        # Known successes may never be regenerated if a checkpoint disappears.
        adapter.known_successes = {k for k, v in state['results'].items() if v['status'] == 'success'}
        done = 0
        for row in selected:
            key = (row['identity'] or {}).get('chunkId', '') + ':' + row['role']
            adapter.known_successes = {key} if state['results'].get(row['id'], {}).get('status') == 'success' else set()
            try:
                result = adapter.embed_text(row['text'], role=row['role'], identity=row['identity'])
                if row['id'] in state['results'] and state['results'][row['id']].get('signature') != result['signature']:
                    raise ValueError('Successful signature changed')
                state['results'][row['id']] = {'status': 'success', 'signature': result['signature']}
                write_json(state_file, state)
                if not result['reused']:
                    done += 1
                    pause(2)
            except Exception:
                # Keep success evidence intact, including on corrupt/missing cache.
                state['stoppedAt'] = row['id']
                write_json(state_file, state)
                raise
            if done >= limit:
                break
        return state
    finally:
        lock.unlink()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--kind', choices=['query', 'parent'], required=True)
    p.add_argument('--directory', type=Path, required=True)
    p.add_argument('--mode', choices=['plan', 'fake', 'gemini', 'export'], default='plan')
    p.add_argument('--approve-plan')
    p.add_argument('--allow-paid', action='store_true')
    p.add_argument('--ids', nargs='+')
    p.add_argument('--limit', type=int, default=10)
    a = p.parse_args()
    directory = a.directory.resolve()
    if not directory.is_relative_to(ROOT / '.local-tools'):
        raise ValueError('Use private .local-tools output')
    directory.mkdir(parents=True, exist_ok=True)
    spec = plan(a.kind)
    plan_file = directory / 'plan.json'
    if a.mode == 'plan':
        if plan_file.exists() and json.loads(plan_file.read_text()) != spec:
            raise ValueError('Existing plan changed')
        if not plan_file.exists():
            write_json(plan_file, spec)
        print(json.dumps({'planHash': file_digest(plan_file), 'count': len(spec['rows']),
                          'reserveUsd': spec['firstAttemptReserveUsd'], 'apiCalls': 0}))
        return
    if file_digest(plan_file) != a.approve_plan or json.loads(plan_file.read_text()) != spec:
        raise ValueError('Exact current plan approval required')
    fake = a.mode == 'fake'
    if a.mode == 'gemini' and (not a.allow_paid or not LEDGER.is_file()):
        raise PermissionError('Separate paid authorization and existing shared ledger required')
    output = directory / 'fake-checkpoints' if fake else CHECKPOINTS
    sdk = FakeSDK() if fake else None
    options = {'client_factory': lambda _: sdk} if fake else {}
    if a.mode == 'export':
        options = {'client_factory': lambda _: (_ for _ in ()).throw(PermissionError('Export cannot call API'))}
    adapter = BatchAdapter(output, max_cost_usd=20, max_calls=CATALOG['maxCalls'], allow_paid=True,
        execution_mode='fake-sdk' if fake else 'gemini', ledger_path=directory / 'fake-ledger.json' if fake else LEDGER,
        sleep=stop_retry, **options)
    if a.mode == 'export':
        state = json.loads((directory / 'state.json').read_text())
        expected = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        if state['planHash'] != expected or state['mode'] != 'gemini':
            raise ValueError('Real matching state required')
        records = []
        selected = spec['rows'] if a.ids is None else [r for r in spec['rows'] if r['id'] in a.ids]
        if a.ids is not None and set(a.ids) != {r['id'] for r in selected}:
            raise ValueError('Unknown export IDs')
        for row in selected:
            entry = state['results'].get(row['id'], {})
            if entry.get('status') != 'success':
                raise ValueError('Incomplete requested checkpoints')
            cp = adapter.embed_text(row['text'], role=row['role'], identity=row['identity'])
            if not cp['reused'] or cp['signature'] != entry['signature']:
                raise ValueError('Checkpoint mismatch')
            records.append({**row, 'kind': row['role'], 'queryText': row['text'] if row['role'] == 'query' else None,
                'vectorDigest': hashlib.sha256(struct.pack('<3072d', *cp['embedding'])).hexdigest(),
                'embedding': cp['embedding'], 'metadata': {k: v for k, v in cp.items() if k != 'embedding'}})
        write_json(directory / 'bundle.json', {'schemaVersion': 'evaluation_bundle_v1',
            'kind': a.kind, 'planSha256': a.approve_plan, 'bankSha256': spec['bankSha256'],
            'executionMode': 'gemini', 'records': records})
    else:
        run_batch(spec, adapter, directory, ids=a.ids, limit=a.limit, pause=(lambda _: None) if fake else time.sleep)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'errorType': type(error).__name__, 'details': 'redacted'}))
        raise SystemExit(1) from None
