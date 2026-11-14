"""Strict allowlist for provider diagnostics; never serialize raw errors/requests."""
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

_METRIC = re.compile(r'(?:generativelanguage|aiplatform)\.googleapis\.com/[a-z][a-z0-9_]{0,159}')
_CODES = {'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED',
          'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND'}


def safe_error_diagnostics(error, *, model, signature, modality):
    """Read SDK structured fields and selected response headers, never response.text."""
    result = {'observedAt': datetime.now(timezone.utc).isoformat(), 'model': 'gemini-embedding-2'}
    if model != 'gemini-embedding-2':
        result['model'] = 'unsupported'
    if re.fullmatch(r'[a-f0-9]{64}', signature or ''):
        result['requestSignature'] = signature
    if modality in {'text', 'query', 'audio', 'visual'}:
        result['modality'] = modality
    try:
        response = getattr(error, 'response', None)
        code = getattr(error, 'code', None)
        if not isinstance(code, int) or isinstance(code, bool):
            code = getattr(response, 'status_code', None)
        if isinstance(code, int) and not isinstance(code, bool) and 100 <= code <= 599:
            result['httpStatus'] = code
        body = getattr(error, 'details', None)
        if not isinstance(body, dict):
            body = {}
        body = body.get('error', body)
        if not isinstance(body, dict):
            body = {}
        status = body.get('status', getattr(error, 'status', None))
        if isinstance(status, str) and status in _CODES:
            result['errorCode'] = status
        metrics = set()
        # Only retain a complete approved metric token, not surrounding message text.
        for source in [body.get('message'), getattr(error, 'message', None)]:
            if isinstance(source, str):
                metrics.update(_METRIC.findall(source))
        details = body.get('details', [])
        for detail in details if isinstance(details, list) else []:
            if not isinstance(detail, dict):
                continue
            metadata = detail.get('metadata', {})
            if isinstance(metadata, dict):
                metric = metadata.get('quota_metric', metadata.get('quotaMetric'))
                if isinstance(metric, str) and _METRIC.fullmatch(metric):
                    metrics.add(metric)
            for violation in detail.get('violations', []) if isinstance(detail.get('violations'), list) else []:
                if not isinstance(violation, dict):
                    continue
                metric = violation.get('quotaMetric', violation.get('quota_metric'))
                if isinstance(metric, str) and _METRIC.fullmatch(metric):
                    metrics.add(metric)
            delay = detail.get('retryDelay')
            if isinstance(delay, str) and re.fullmatch(r'\d{1,8}(?:\.\d{1,9})?s', delay):
                result['rpcRetryDelaySeconds'] = float(delay[:-1])
        if metrics:
            result['quotaMetrics'] = sorted(metrics)[:16]
        headers = getattr(response, 'headers', {}) or {}
        retry = headers.get('retry-after', headers.get('Retry-After'))
        if isinstance(retry, str):
            if re.fullmatch(r'\d{1,8}', retry.strip()):
                result['retryAfterSeconds'] = int(retry.strip())
            else:
                try:
                    value = parsedate_to_datetime(retry)
                    if value.tzinfo is not None:
                        result['retryAfterUtc'] = value.astimezone(timezone.utc).isoformat()
                except (ValueError, TypeError, OverflowError):
                    pass
        request_id = headers.get('x-request-id', headers.get('x-goog-request-id'))
        if isinstance(request_id, str) and re.fullmatch(r'(?:[a-fA-F0-9]{16,64}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})', request_id):
            result['providerRequestId'] = request_id
    except Exception:
        # Diagnostic parsing must not prevent the original failed checkpoint save.
        pass
    return result
