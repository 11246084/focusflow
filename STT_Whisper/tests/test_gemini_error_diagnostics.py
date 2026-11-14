import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from gemini_error_diagnostics import safe_error_diagnostics
from run_video1_batch import BatchAdapter,stop_retry

class SafeDiagnosticsTests(unittest.TestCase):
    def error(self, retry='12'):
        from google.genai.errors import ClientError
        import httpx
        secret='AIza_PRIVATE_CREDENTIAL_DO_NOT_LOG'
        body={'error':{'code':429,'status':'RESOURCE_EXHAUSTED','message':secret+' private transcript',
            'details':[{'@type':'type.googleapis.com/google.rpc.QuotaFailure','violations':[{
                'quotaMetric':'aiplatform.googleapis.com/global_embed_content_requests_per_minute_per_base_model',
                'quotaId':secret,'quotaDimensions':{'project':secret},'description':'private transcript'}]},
                {'@type':'type.googleapis.com/google.rpc.RetryInfo','retryDelay':'4.5s'}]}}
        response=httpx.Response(429,headers={'Retry-After':retry,'Authorization':'Bearer '+secret,
            'x-request-id':'12345678-abcd-abcd-abcd-123456789abc','x-api-key':secret},
            request=httpx.Request('POST','https://example.invalid/?key='+secret),json=body)
        return ClientError(429,body,response)

    def test_sdk_structured_quota_and_headers_are_allowlisted(self):
        r=safe_error_diagnostics(self.error(),model='gemini-embedding-2',signature='a'*64,modality='text')
        self.assertEqual(r['httpStatus'],429)
        self.assertEqual(r['errorCode'],'RESOURCE_EXHAUSTED')
        self.assertEqual(r['retryAfterSeconds'],12)
        self.assertEqual(r['rpcRetryDelaySeconds'],4.5)
        self.assertEqual(len(r['quotaMetrics']),1)
        self.assertIn('providerRequestId',r)
        text=json.dumps(r)
        for forbidden in ['AIza','Bearer','private transcript','quotaDimensions','key=']:
            self.assertNotIn(forbidden,text)

    def test_date_and_absent_or_invalid_details(self):
        r=safe_error_diagnostics(self.error('Wed, 21 Oct 2015 07:28:00 GMT'),model='gemini-embedding-2',signature='b'*64,modality='query')
        self.assertEqual(r['retryAfterUtc'],'2015-10-21T07:28:00+00:00')
        r=safe_error_diagnostics(ValueError('PRIVATE'),model='untrusted secret',signature='PRIVATE',modality='PRIVATE')
        self.assertEqual(set(r),{'observedAt','model'})
        e=SimpleNamespace(code=429,details={'error':{'status':{},'message':'secret'}},response=None)
        r=safe_error_diagnostics(e,model='gemini-embedding-2',signature=None,modality='text')
        self.assertEqual(r['httpStatus'],429)

    def test_message_metric_only_and_untrusted_headers_omitted(self):
        e=SimpleNamespace(code=429,status='RESOURCE_EXHAUSTED',message='private text Quota exceeded for generativelanguage.googleapis.com/embed_content_paid_tier_requests secret',details=None,
            response=SimpleNamespace(headers={'retry-after':'AIzaSECRET','x-request-id':'AIzaSECRET'}))
        r=safe_error_diagnostics(e,model='gemini-embedding-2',signature='c'*64,modality='audio')
        self.assertEqual(r['quotaMetrics'],['generativelanguage.googleapis.com/embed_content_paid_tier_requests'])
        self.assertNotIn('retryAfterSeconds',r)
        self.assertNotIn('providerRequestId',r)
        self.assertNotIn('private',json.dumps(r))

    def test_twenty_dollar_ceiling_blocks_before_provider(self):
        from gemini_multimodal_adapter import PRICING_VERSION
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);ledger=root/'ledger.json'
            original={'calls':1,'reservedUsd':19.999,'pricingVersion':PRICING_VERSION,'attemptsBySignature':{}}
            ledger.write_text(json.dumps(original))
            def forbidden(_):raise AssertionError('Provider must not initialize')
            a=BatchAdapter(root/'cp',max_cost_usd=20,max_calls=100,allow_paid=True,
                execution_mode='fake-sdk',ledger_path=ledger,client_factory=forbidden,sleep=stop_retry)
            with self.assertRaises(PermissionError):a.embed_text('budget fixture')
            self.assertEqual(json.loads(ledger.read_text()),original)

    def test_mock_429_checkpoint_records_safe_fields_once_and_retains_reserve(self):
        error=self.error()
        class Client:
            def __init__(self):self.models=self;self.calls=0
            def embed_content(self,**kwargs):self.calls+=1;raise error
            def close(self):pass
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);client=Client();a=BatchAdapter(root/'cp',max_cost_usd=20,max_calls=3,
                allow_paid=True,execution_mode='fake-sdk',ledger_path=root/'ledger.json',
                client_factory=lambda _:client,sleep=stop_retry)
            with self.assertRaises(PermissionError):a.embed_text('private transcript')
            cp=json.loads(next((root/'cp').glob('*.json')).read_text())
            self.assertEqual(cp['error']['diagnostics']['httpStatus'],429)
            self.assertEqual(cp['attempts'],1)
            with self.assertRaises(PermissionError):a.embed_text('private transcript')
            self.assertEqual(client.calls,1)
            ledger=json.loads((root/'ledger.json').read_text());self.assertEqual(ledger['calls'],1)
            self.assertGreater(ledger['reservedUsd'],0)
            text=json.dumps(cp)
            self.assertNotIn('AIza',text);self.assertNotIn('private transcript',text)

if __name__=='__main__':unittest.main()
