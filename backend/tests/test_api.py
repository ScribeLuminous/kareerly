import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.matching_service import MatchingModelUnavailable
import threading
from concurrent.futures import ThreadPoolExecutor

class ApiRegressionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        self.assertEqual(self.client.get('/api/health').json(), {'status': 'ok'})

    def test_health_config_reports_origins_and_model(self):
        payload = self.client.get('/api/health/config').json()
        self.assertEqual(payload['status'], 'ok')
        self.assertIn('http://localhost:5173', payload['allowed_origins'])
        # Probing by path must not pull the checkpoint into memory.
        self.assertEqual(payload['model']['missing_files'], [])
        self.assertTrue(payload['model']['files_present'])
        self.assertIn('loaded', payload['model'])

    def test_startup_warmup_runs_without_blocking_or_breaking_boot(self):
        with patch('backend.app.main.warm_matching_caches') as warm:
            with TestClient(app) as client:
                self._join_warmup()
                self.assertEqual(client.get('/api/health').status_code, 200)
            warm.assert_called_once()

        # A warmup that raises costs latency, not availability.
        with patch('backend.app.main.warm_matching_caches', side_effect=RuntimeError('checkpoint missing')):
            with TestClient(app) as client:
                self._join_warmup()
                self.assertEqual(client.get('/api/health').status_code, 200)
                self.assertEqual(client.get('/api/health/config').status_code, 200)

    def test_warmup_can_be_disabled(self):
        with patch('backend.app.main.WARMUP_ENABLED', False), patch('backend.app.main.warm_matching_caches') as warm:
            with TestClient(app) as client:
                self._join_warmup()
                self.assertEqual(client.get('/api/health').status_code, 200)
            warm.assert_not_called()

    @staticmethod
    def _join_warmup():
        for thread in threading.enumerate():
            if thread.name == 'matching-warmup':
                thread.join(60)

    def test_cors(self):
        for origin in ['http://localhost:5173', 'http://127.0.0.1:5173']:
            for path in ['/api/matches/run', '/api/matches/from-resume']:
                result = self.client.options(path, headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization'})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.headers['access-control-allow-origin'], origin)

    def test_matching_reachable_and_server_failure(self):
        self.assertEqual(self.client.post('/api/matches/run', json={}).status_code, 422)
        self.assertEqual(self.client.post('/api/matches/from-resume').status_code, 422)
        with patch('backend.app.main.run_matching', side_effect=RuntimeError('model unavailable')):
            result = self.client.post('/api/matches/run', json={'resume_text_for_matching': 'SQL developer'})
            self.assertEqual(result.status_code, 500)
            self.assertIn('model unavailable', result.json()['detail'])
        self.assertEqual(self.client.post('/api/matches/from-resume', files={'file': ('resume.txt', b'text')}).status_code, 400)

    def test_both_matching_routes_dispatch_successfully(self):
        with patch('backend.app.main.run_matching', return_value={}) as match, patch('backend.app.main._apply_report_access_control', return_value={'fit_now_matches': []}):
            result = self.client.post('/api/matches/run', json={'resume_text_for_matching': 'SQL developer'})
            self.assertEqual(result.status_code, 200)
            match.assert_called_once()

        with patch('backend.app.main.run_matching', return_value={}) as match, \
             patch('backend.app.main._apply_report_access_control', return_value={'fit_now_matches': []}):
            result = self.client.post('/api/matches/run-form',
                files={'payload': (None, '{"resume_text_for_matching":"SQL developer"}')},
                headers={'Origin': 'http://localhost:5173'},
            )
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.headers['access-control-allow-origin'], 'http://localhost:5173')
            match.assert_called_once()

        with patch('backend.app.main.run_matching', return_value={}) as match, \
             patch('backend.app.main._apply_report_access_control', return_value={'fit_now_matches': []}):
            result = self.client.post(
                '/api/matches/from-resume',
                files={'file': ('resume.pdf', b'not needed when normalized text is supplied')},
                data={'resume_text_for_matching': 'Python developer with SQL experience'},
            )
            self.assertEqual(result.status_code, 200)
            match.assert_called_once()
            # The Step 1 text is used; the file is not parsed again.
            self.assertIsNone(match.call_args.kwargs['file_bytes'])
            self.assertEqual(match.call_args.kwargs['resume_text'], 'Python developer with SQL experience')

        with patch('backend.app.main.run_matching', return_value={}) as match, patch('backend.app.main._apply_report_access_control', return_value={'fit_now_matches': []}):
            result = self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')})
            self.assertEqual(result.status_code, 200)
            match.assert_called_once()
            self.assertEqual(match.call_args.kwargs['file_bytes'], b'%PDF sample')

    def test_match_routes_call_matching_with_supported_arguments(self):
        import inspect
        from backend.app.services import matching_service
        with patch('backend.app.main.run_matching', autospec=matching_service.run_matching, return_value={}) as match, \
             patch('backend.app.main._apply_report_access_control', return_value={}):
            self.assertEqual(self.client.post('/api/matches/run', json={'resume_text_for_matching': 'SQL developer'}).status_code, 200)
            self.assertEqual(self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')},
                data={'removed_skill_ids': '["sk004"]'}).status_code, 200)
        self.assertEqual(match.call_count, 2)
        self.assertEqual(match.call_args.kwargs['removed_skill_ids'], ['SK004'])
        self.assertIn('file_bytes', inspect.signature(matching_service.run_matching).parameters)

    def test_text_matching_accepts_confirmed_skill_records_without_file_reprocessing(self):
        confirmed_skills = [
            {'skill_id': 'SK004', 'skill_name': 'SQL', 'is_standardized': True},
            {'skill_id': None, 'skill_name': 'Stakeholder facilitation', 'source': 'custom', 'is_standardized': False},
        ]
        with patch('backend.app.main.run_matching', return_value={}) as match, \
             patch('backend.app.main._apply_report_access_control', return_value={}):
            result = self.client.post('/api/matches/run', json={
                'resume_text_for_matching': 'SQL developer and stakeholder facilitator',
                'confirmed_skills': confirmed_skills,
            })
        self.assertEqual(result.status_code, 200)
        match.assert_called_once()
        records = match.call_args.kwargs['confirmed_skills']
        self.assertEqual(records[0]['skill_id'], 'SK004')
        self.assertEqual(records[1]['skill_id'], '')
        self.assertEqual(records[1]['skill_name'], 'Stakeholder facilitation')

    def test_form_matching_preserves_confirmed_skills_and_rejects_bad_payload(self):
        import json
        with patch('backend.app.main.run_matching', return_value={}) as match, \
             patch('backend.app.main._apply_report_access_control', return_value={}):
            result = self.client.post('/api/matches/run-form', data={'payload': json.dumps({
                'resume_text_for_matching': 'SQL developer',
                'confirmed_skills': [{'skill_id': 'SK004', 'skill_name': 'SQL'}],
            })})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(match.call_args.kwargs['confirmed_skills'][0]['skill_id'], 'SK004')
        for invalid in ('not json', '[]', '{}'):
            self.assertEqual(self.client.post('/api/matches/run-form', data={'payload': invalid}).status_code, 422)

    def test_empty_confirmed_skills_fall_back_to_resume_extraction(self):
        with patch('backend.app.main.run_matching', return_value={}) as match, \
             patch('backend.app.main._apply_report_access_control', return_value={}):
            self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')}, data={'confirmed_skills': '[]'})
            self.assertIsNone(match.call_args.kwargs['confirmed_skills'])
            self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')}, data={'confirmed_skills': '[{"skill_id": "SK004", "skill_name": "SQL"}]'})
            self.assertEqual(match.call_args.kwargs['confirmed_skills'][0]['skill_id'], 'SK004')

    def test_registered_report_is_returned_before_supabase_sync(self):
        order = []
        def trim(result, *_):
            result['fit_now_matches'] = result['fit_now_matches'][:1]
            order.append('response')
            return result
        def sync(**kwargs):
            order.append(('sync', len(kwargs['result']['fit_now_matches'])))
        with patch('backend.app.main.run_matching', return_value={'fit_now_matches': [1, 2, 3]}), \
             patch('backend.app.main._apply_report_access_control', side_effect=trim), \
             patch('backend.app.main._sync_match_results_to_supabase', side_effect=sync):
            result = self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')}, data={'user_mode': 'registered'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(order, ['response', ('sync', 3)])

    def test_failed_background_sync_does_not_fail_the_report(self):
        with patch('backend.app.main.run_matching', return_value={}), \
             patch('backend.app.main._apply_report_access_control', return_value={}), \
             patch('backend.app.main._sync_match_results_to_supabase', side_effect=RuntimeError('supabase down')):
            result = self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')}, data={'user_mode': 'registered'})
        self.assertEqual(result.status_code, 200)

    def test_health_responds_while_matching_is_running(self):
        started = threading.Event()
        release = threading.Event()
        def slow_match(**kwargs):
            started.set()
            release.wait(5)
            return {}
        with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor, patch('backend.app.main.run_matching', side_effect=slow_match):
            future = executor.submit(client.post, '/api/matches/run', json={'resume_text_for_matching': 'SQL developer'})
            try:
                self.assertTrue(started.wait(2))
                self.assertEqual(client.get('/api/health').status_code, 200)
                self.assertFalse(future.done())
            finally:
                release.set()
            self.assertEqual(future.result().status_code, 200)

    def test_model_failure_is_readable_with_cors(self):
        with patch('backend.app.main.run_matching', side_effect=MatchingModelUnavailable('Model not cached')):
            result = self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')}, headers={'Origin': 'http://localhost:5173'})
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.json()['detail'], 'Model not cached')
        self.assertEqual(result.headers['access-control-allow-origin'], 'http://localhost:5173')
        with patch('backend.app.main.run_matching', side_effect=MatchingModelUnavailable('Model not cached')):
            result = self.client.post('/api/matches/run', json={'resume_text_for_matching': 'SQL developer'}, headers={'Origin': 'http://localhost:5173'})
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.headers['access-control-allow-origin'], 'http://localhost:5173')

    def test_pdf_checks_do_not_verify_credentials(self):
        self.assertEqual(self.client.post('/api/certificates/validate').status_code, 422)
        for name, data in [('bad.pdf', b'not PDF'), ('empty.pdf', b''), ('bad.txt', b'%PDF /Type /Page')]:
            self.assertEqual(self.client.post('/api/certificates/validate', files={'certificate': (name, data)}).status_code, 400)
        result = self.client.post('/api/certificates/validate', files={'certificate': ('project.pdf', b'%PDF-1.4 /Type /Page')})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['status'], 'valid')
        self.assertIn('Pending Verification', result.json()['message'])
        self.assertIn('not been verified', result.json()['message'])

if __name__ == '__main__':
    unittest.main()
