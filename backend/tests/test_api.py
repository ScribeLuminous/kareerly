import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app.main import app

class ApiRegressionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        self.assertEqual(self.client.get('/api/health').json(), {'status': 'ok'})

    def test_cors(self):
        for origin in ['http://localhost:5173', 'http://127.0.0.1:5173']:
            for path in ['/api/matches/run', '/api/matches/from-resume']:
                result = self.client.options(path, headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization'})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.headers['access-control-allow-origin'], origin)

    def test_matching_reachable_and_server_failure(self):
        self.assertEqual(self.client.post('/api/matches/run', json={}).status_code, 422)
        self.assertEqual(self.client.post('/api/matches/from-resume').status_code, 422)
        with patch('backend.app.main.match_jobs', side_effect=RuntimeError('model unavailable')):
            result = self.client.post('/api/matches/run', json={'resume_text_for_matching': 'SQL developer'})
            self.assertEqual(result.status_code, 500)
            self.assertIn('model unavailable', result.json()['detail'])
        self.assertEqual(self.client.post('/api/matches/from-resume', files={'file': ('resume.txt', b'text')}).status_code, 400)

    def test_both_matching_routes_dispatch_successfully(self):
        with patch('backend.app.main.match_jobs', return_value={}) as match, patch('backend.app.main._apply_report_access_control', return_value={'fit_now_matches': []}):
            result = self.client.post('/api/matches/run', json={'resume_text_for_matching': 'SQL developer'})
            self.assertEqual(result.status_code, 200)
            match.assert_called_once()
        with patch('backend.app.main.match_resume_to_jobs', return_value={}) as match, patch('backend.app.main._apply_report_access_control', return_value={'fit_now_matches': []}):
            result = self.client.post('/api/matches/from-resume', files={'file': ('resume.pdf', b'%PDF sample')})
            self.assertEqual(result.status_code, 200)
            match.assert_called_once()

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
