"""Scope-locked evaluation Query/Parent batches; default is free planning only."""
import argparse
import hashlib
import json
import time
import struct
import math
from pathlib import Path
from run_video1_batch import ROOT, LEDGER, CHECKPOINTS, CATALOG, BatchAdapter, stop_retry
from gemini_multimodal_adapter import estimate_cost, build_text_content
from build_parent_chunk_artifact import load_leaf_chunks
from hierarchy_chunking import build_parent_chunks
from run_gemini_validation import FakeSDK, file_digest
from segment_media_embedding import write_json
from embedding_contract import (GEMINI_EMBEDDING_CONTRACT_VERSION,
    GEMINI_EMBEDDING_INSTRUCTION_VERSION, GEMINI_EMBEDDING_GENERATION_VERSION,
    GEMINI_EMBEDDING_NORMALIZATION_VERSION)


def input_signature(row, mode='gemini'):
    payload = build_text_content(row['text'], row['role']).encode('utf-8')
    input_hash = hashlib.sha256(payload).hexdigest()
    if row.get('inputSha256', input_hash) != input_hash:
        raise ValueError('Input digest changed')
    return hashlib.sha256(json.dumps([mode, 'gemini-embedding-2', 3072, row['role'],
        GEMINI_EMBEDDING_CONTRACT_VERSION, row['identity'], input_hash], sort_keys=True).encode()).hexdigest()


def inspect_checkpoints(spec, checkpoint_directory, ledger):
    """Read-only native cache audit; never construct a provider or reserve cost."""
    rows = []
    for row in spec['rows']:
        signature = input_signature(row)
        path = Path(checkpoint_directory) / (signature + '.json')
        result = {'id': row['id'], 'signature': signature, 'status': 'missing',
                  'previousAttempts': ledger.get('attemptsBySignature', {}).get(signature, 0)}
        if path.exists():
            result['checkpointSha256'] = file_digest(path)
            try:
                cp = json.loads(path.read_text(encoding='utf-8'))
                result['previousAttempts'] = max(result['previousAttempts'], cp.get('attempts', 0))
                if cp.get('status') != 'success':
                    result['status'] = 'blocked_prior_attempt'
                else:
                    expected = {'signature': signature, 'status': 'success', 'provider': 'gemini',
                        'model': 'gemini-embedding-2', 'dimension': 3072, 'modality': row['role'],
                        'contractVersion': GEMINI_EMBEDDING_CONTRACT_VERSION,
                        'schemaVersion': GEMINI_EMBEDDING_CONTRACT_VERSION,
                        'instructionVersion': GEMINI_EMBEDDING_INSTRUCTION_VERSION,
                        'generationVersion': GEMINI_EMBEDDING_GENERATION_VERSION,
                        'normalizationVersion': GEMINI_EMBEDDING_NORMALIZATION_VERSION,
                        'taskType': None, **(row['identity'] or {})}
                    if any(key not in cp or cp[key] != value for key, value in expected.items()):
                        raise ValueError('Checkpoint contract or identity differs')
                    values = cp['embedding']
                    if len(values) != 3072 or not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                            and math.isfinite(v) for v in values) or abs(sum(v*v for v in values) - 1) > .001:
                        raise ValueError('Invalid vector')
                    if hashlib.sha256(json.dumps(values).encode()).hexdigest() != cp['embeddingDigest']:
                        raise ValueError('Vector digest differs')
                    result.update(status='reusable', vectorDigest=hashlib.sha256(struct.pack('<3072d', *values)).hexdigest())
            except (ValueError, TypeError, KeyError):
                result['status'] = 'invalid_restore_required'
        elif result['previousAttempts']:
            result['status'] = 'blocked_prior_attempt'
        rows.append(result)
    return {'kind': spec.get('kind'), 'count': len(rows), 'reusable': sum(r['status'] == 'reusable' for r in rows),
        'missing': sum(r['status'] == 'missing' for r in rows),
        'blocked': sum(r['status'] not in ('missing', 'reusable') for r in rows), 'rows': rows,
        'apiCalls': 0, 'ledgerWrites': 0}


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
        state = json.loads(state_file.read_text(encoding='utf-8')) if state_file.exists() else {
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
    p.add_argument('--mode', choices=['plan', 'inspect', 'fake', 'gemini', 'export'], default='plan')
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
        if plan_file.exists() and json.loads(plan_file.read_text(encoding='utf-8')) != spec:
            raise ValueError('Existing plan changed')
        if not plan_file.exists():
            write_json(plan_file, spec)
        print(json.dumps({'planHash': file_digest(plan_file), 'count': len(spec['rows']),
                          'reserveUsd': spec['firstAttemptReserveUsd'], 'apiCalls': 0}))
        return
    if file_digest(plan_file) != a.approve_plan or json.loads(plan_file.read_text(encoding='utf-8')) != spec:
        raise ValueError('Exact current plan approval required')
    if a.mode == 'inspect':
        ledger = json.loads(LEDGER.read_text(encoding='utf-8'))
        report = inspect_checkpoints(spec, CHECKPOINTS, ledger)
        write_json(directory / 'cache-inventory.json', {**report, 'planSha256': a.approve_plan,
            'ledgerSha256': file_digest(LEDGER), 'ledgerCalls': ledger['calls'], 'ledgerReserveUsd': ledger['reservedUsd']})
        print(json.dumps({k: v for k, v in report.items() if k != 'rows'}))
        return
    fake = a.mode == 'fake'
    if a.mode == 'gemini' and (not a.allow_paid or not LEDGER.is_file()):
        raise PermissionError('Separate paid authorization and existing shared ledger required')
    if a.mode == 'gemini':
        selected = spec['rows'] if a.ids is None else [r for r in spec['rows'] if r['id'] in a.ids]
        if not selected or a.ids is not None and set(a.ids) != {r['id'] for r in selected}:
            raise ValueError('Unknown or empty IDs')
        inventory = inspect_checkpoints({'rows': selected}, CHECKPOINTS, json.loads(LEDGER.read_text(encoding='utf-8')))
        if inventory['blocked']:
            raise ValueError('Restore invalid caches or resolve prior attempts before paid execution')
    output = directory / 'fake-checkpoints' if fake else CHECKPOINTS
    sdk = FakeSDK() if fake else None
    options = {'client_factory': lambda _: sdk} if fake else {}
    if a.mode == 'export':
        options = {'client_factory': lambda _: (_ for _ in ()).throw(PermissionError('Export cannot call API'))}
    adapter = BatchAdapter(output, max_cost_usd=20, max_calls=CATALOG['maxCalls'], allow_paid=True,
        execution_mode='fake-sdk' if fake else 'gemini', ledger_path=directory / 'fake-ledger.json' if fake else LEDGER,
        sleep=stop_retry, **options)
    if a.mode == 'export':
        state = json.loads((directory / 'state.json').read_text(encoding='utf-8'))
        expected = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        if state['planHash'] != expected or state['mode'] != 'gemini':
            raise ValueError('Real matching state required')
        records = []
        selected = spec['rows'] if a.ids is None else [r for r in spec['rows'] if r['id'] in a.ids]
        if a.ids is not None and set(a.ids) != {r['id'] for r in selected}:
            raise ValueError('Unknown export IDs')
        # Validate the entire requested cache before the adapter can create locks or touch files.
        inventory = inspect_checkpoints({'rows': selected}, CHECKPOINTS, json.loads(LEDGER.read_text(encoding='utf-8')))
        if inventory['reusable'] != len(selected) or not selected:
            raise ValueError('Export requires complete valid native checkpoints')
        for item in inventory['rows']:
            if state['results'].get(item['id'], {}).get('signature') != item['signature']:
                raise ValueError('Export state signature differs')
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
