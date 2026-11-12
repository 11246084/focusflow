"""Frozen six-video source catalog shared with the Atlas tools; no database or provider calls."""
import concurrent.futures
import json
import math
from pathlib import Path

from plan_multimodal_validation import load_chunks
from run_gemini_validation import file_digest, prepare_requests
from segment_media_embedding import cut_media, probe_duration, sample_window, write_json
from utils import resolve_ffmpeg_binary

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / 'backend/scripts/atlas-multimodal/corpus.json').read_text(encoding='utf-8'))


def specification(video_id):
    return next((v for v in CATALOG['videos'] if v['videoId'] == video_id), None)


def ids_for(spec):
    return [f"{spec['videoId']}_chunk_{i:04d}" for i in range(1, spec['count'] + 1)]


def validate_scope(manifest):
    spec = specification(manifest.get('videoId'))
    if not spec or spec['key'] == 'V1' or manifest.get('schemaVersion') != 'video_manifest_v1' \
            or manifest.get('courseId') != CATALOG['courseId'] or manifest.get('ids') != ids_for(spec) \
            or any(manifest.get(k) != spec[k] for k in ['sourceSha256', 'artifactSha256', 'durationSec']) \
            or len(manifest.get('chunks', [])) != spec['count'] \
            or {c['chunkId'] for c in manifest['chunks']} != set(ids_for(spec)):
        raise ValueError('Frozen corpus allowlist differs')
    for c in manifest['chunks']:
        skipped = c['chunkId'] in spec['skipMediaIds']
        if c['courseId'] != CATALOG['courseId'] or c['videoId'] != spec['videoId'] or not c['text'].strip() \
                or not all(math.isfinite(c[k]) for k in ['startSec', 'endSec']) \
                or not 0 <= c['startSec'] < c['endSec'] <= spec['durationSec'] \
                or (c['endSec'] - c['startSec'] > 60) != skipped \
                or set(c['media']) != (set() if skipped else {'audio', 'visual'}) \
                or skipped and c.get('skipMediaReason') != 'duration_over_60s':
            raise ValueError('Invalid source identity or media eligibility')
    return manifest


def verify_source(spec):
    source = ROOT / 'backend/uploads' / spec['filename']
    artifact = ROOT / 'STT_Whisper/data/outputs/runs' / spec['run'] / 'embeddings_text_gemini.jsonl'
    if file_digest(source) != spec['sourceSha256'] or file_digest(artifact) != spec['artifactSha256']:
        raise ValueError('Frozen source or artifact changed')
    return source, artifact


def verify_manifest_source(manifest):
    validate_scope(manifest)
    spec = specification(manifest['videoId'])
    _, artifact = verify_source(spec)
    rows = {r['chunkId']: r for r in load_chunks(artifact, spec['videoId'])}
    for c in manifest['chunks']:
        if c['chunkId'] not in rows or any(c[k] != rows[c['chunkId']][k]
                for k in ['courseId', 'videoId', 'startSec', 'endSec', 'text']):
            raise ValueError('Approved manifest differs from the frozen native transcript')


def prepare_scope(spec, destination):
    source, artifact = verify_source(spec)
    destination = Path(destination).resolve()
    if not destination.is_relative_to(ROOT / '.local-tools') or destination.exists():
        raise ValueError('Use a new private manifest; never overwrite an approved one')
    destination.parent.mkdir(parents=True, exist_ok=True)
    media_root = destination.parent / 'media'
    media_root.mkdir(exist_ok=True)
    chunks = load_chunks(artifact, spec['videoId'])
    ffmpeg = resolve_ffmpeg_binary()
    duration = probe_duration(source, ffmpeg)
    if abs(duration - spec['durationSec']) > .01:
        raise ValueError('Source duration changed')
    # Only V4 has original paid media to reuse. Preserve its exact bytes and sampling identity.
    old = {}
    if spec['key'] == 'V4':
        requests, _ = prepare_requests(ROOT, ROOT / '.local-tools/phase2-validation')
        old = {(r['identity']['chunkId'], r['kind']): r['mediaRecord'] for r in requests
               if r['identity']['videoId'] == spec['videoId'] and r['kind'] in ('audio', 'visual')}

    def prepare(c):
        window = sample_window(c, duration)
        c['media'] = {}
        if window is None:
            c['skipMediaReason'] = 'duration_over_60s'
            return c
        for kind, suffix in [('audio', '.wav'), ('visual', '.mp4')]:
            saved = old.get((c['chunkId'], kind))
            target = Path(saved['mediaPath']) if saved else media_root / (c['chunkId'] + '-' + kind + suffix)
            if not saved and not target.exists():
                cut_media(source, target, kind, *window, ffmpeg)
            digest = file_digest(target)
            if saved and digest != saved['mediaSha256']:
                raise ValueError('Saved paid input changed')
            seconds = probe_duration(target, ffmpeg)
            tolerance = 1 if kind == 'visual' else .15
            if abs(seconds - (window[1] - window[0])) > tolerance or target.stat().st_size > 15 * 1024 * 1024:
                raise ValueError('Prepared media invalid')
            c['media'][kind] = {'mediaPath': str(target.resolve()), 'sha256': digest,
                'sampleStartSec': window[0], 'sampleEndSec': window[1], 'durationSec': seconds}
        return c

    chunks = list(concurrent.futures.ThreadPoolExecutor(max_workers=3).map(prepare, chunks))
    manifest = validate_scope({'schemaVersion': 'video_manifest_v1', 'courseId': CATALOG['courseId'],
        **{k: spec[k] for k in ['videoId', 'sourceSha256', 'artifactSha256', 'durationSec']},
        'ids': ids_for(spec), 'chunks': chunks})
    write_json(destination, manifest)
    return {'video': spec['key'], 'chunks': len(chunks), 'inputs': sum(1 + len(c['media']) for c in chunks),
        'skippedMediaChunks': spec['skipMediaIds'], 'manifestSha256': file_digest(destination), 'paidCalls': 0}
