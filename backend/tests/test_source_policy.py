import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline.normalize import normalize_all, normalize_record
from pipeline.sources.jsearch import JSearchSource
from pipeline.cli import main


def raw(source='jsearch', **payload):
    return dict(source=source, source_id='1', payload=dict(title='Telehealth Nurse',
        description='Provide patient care and assessment. ' * 12,
        company='Clinic', location='Manila', **payload))


class SourcePolicyTests(unittest.TestCase):
    def test_jooble_direct_and_imported_excluded(self):
        for record in [raw('jooble'), raw(origin_board='Jooble'),
                       dict(raw(), source_url='https://ph.jooble.org/jobs/1'),
                       raw(provider_record={'apply_options': [{'publisher': 'Jooble'}]})]:
            self.assertEqual(normalize_record(record).corpus_tier, 'excluded')

    def test_eligible_ats_healthcare_kept(self):
        self.assertEqual(normalize_record(raw('greenhouse')).corpus_tier, 'match')

    def test_excluded_duplicate_does_not_hide_eligible(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'raw').mkdir()
            (root/'raw'/'input.jsonl').write_text('\n'.join(map(json.dumps,[raw('jooble'),raw('greenhouse')]))+'\n')
            counts=normalize_all(root/'raw', root/'normalized.jsonl')
            self.assertEqual(counts['match'],1)
            self.assertEqual(counts['excluded'],1)

    def test_jsearch_preserves_provider_and_missing_location(self):
        source=JSearchSource(api_key='test-only',pause_seconds=0)
        job={'job_id':'a','job_title':'Nurse','job_description':'Clinical care', 'job_highlights':[], 'job_offer_expiration_datetime_utc':'2026-10-01'}
        with patch.object(source,'_get',return_value={'data':[job]}):
            record=list(source.fetch(keywords=['nurse']))[0]
        self.assertEqual(record.payload['provider_record'],job)
        self.assertEqual(record.payload['location'],'')
        self.assertEqual(record.source_url,'')

    def test_provider_failure_is_not_empty_success(self):
        source=JSearchSource(api_key='test-only',pause_seconds=0)
        with patch.object(source,'_get',side_effect=RuntimeError('quota')):
            with self.assertRaises(RuntimeError):
                list(source.fetch())

    def test_budget_prevents_network_call(self):
        source=JSearchSource(api_key='test-only',request_budget=1)
        source.requests_used=1
        with patch('pipeline.sources.jsearch.urlopen') as network:
            with self.assertRaises(RuntimeError):
                source._get({})
            network.assert_not_called()

    def test_cli_preserves_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'jsearch').mkdir()
            snapshot=root/'jsearch'/'existing.jsonl'
            snapshot.write_text('original')
            with patch('pipeline.cli.RAW_DIR',root), patch('pipeline.cli.get_source') as factory:
                self.assertEqual(main(['collect','--source','jsearch','--run-id','existing']),1)
                factory.return_value.fetch.assert_not_called()
            self.assertEqual(snapshot.read_text(),'original')

    def test_cli_blocks_jooble_without_network(self):
        with patch('pipeline.cli.get_source') as factory:
            self.assertEqual(main(['collect','--source','jooble']),1)
            factory.assert_not_called()
