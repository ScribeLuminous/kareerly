import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import numpy as np
from models.upgrade_experiment import metrics, paired_interval, read
from models.score_independent_review import graded_metrics, validated_export


class UpgradeEvaluationTests(unittest.TestCase):
    def test_ranking_metrics_penalize_late_relevance(self):
        q = [{'query_id': 'q', 'source_resume_category': 'x', 'relevant_ids': ['b']}]
        jobs = [{'job_id': 'a'}, {'job_id': 'b'}, {'job_id': 'c'}]
        result = metrics(np.array([[3, 2, 1]]), q, jobs, k=2)['aggregate']
        self.assertAlmostEqual(result['ndcg10'], 1/np.log2(3))
        self.assertEqual(result['recall10'], 1)
        self.assertEqual(result['precision10'], .5)
        self.assertEqual(result['mrr10'], .5)

    def test_bootstrap_is_paired_and_zero_for_identical_runs(self):
        rows = [{'query_id': str(i), 'ndcg10': i/10} for i in range(5)]
        self.assertEqual(paired_interval(rows, rows)['ci95'], [0, 0])
        with self.assertRaises(AssertionError):
            paired_interval(rows, rows[::-1])

    def test_jsonl_accepts_embedded_unicode_line_separator(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'rows.jsonl'
            path.write_text(json.dumps({'text': 'a\u2028b'}, ensure_ascii=False)+'\n')
            self.assertEqual(read(path), [{'text': 'a\u2028b'}])

    def test_human_metrics_keep_no_relevant_queries_explicit(self):
        rows = [{'profile_id': 'p', 'job_id': 'a', 'grade': 0}, {'profile_id': 'p', 'job_id': 'b', 'grade': 0}]
        result = graded_metrics({'p': ['a', 'b']}, rows)
        self.assertIsNone(result['aggregate']['ndcg10'])
        self.assertIsNone(result['aggregate']['recall10'])
        self.assertEqual(result['aggregate']['precision10'], 0)
        with self.assertRaises(ValueError):
            graded_metrics({'p': ['a']}, rows)

    def test_human_metrics_use_graded_gains(self):
        rows = [{'profile_id': 'p', 'job_id': 'a', 'grade': 1}, {'profile_id': 'p', 'job_id': 'b', 'grade': 3}]
        result = graded_metrics({'p': ['a', 'b']}, rows)['aggregate']
        self.assertAlmostEqual(result['ndcg10'], (1+7/np.log2(3))/(7+1/np.log2(3)))
        self.assertEqual(result['mrr10'], .5)

    def test_reviewer_import_rejects_blank_grades_and_identity_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            row = {'pair_id': 'pair', 'profile_id': 'person', 'job_id': 'job', 'partition': 'development', 'reviewer_id': 'A', 'grade': None, 'evidence': ''}
            (root/'reviewer-A-development-blank.jsonl').write_text(json.dumps(row)+'\n')
            export = root/'export.json'
            def write_export():
                export.write_text(json.dumps({'reviewer': 'A', 'partition': 'development', 'pairs': [row]}))
            with patch('models.score_independent_review.REVIEW', root):
                write_export()
                with self.assertRaises(ValueError):
                    validated_export(export, 'A', 'development')
                row.update(grade=2, evidence='Test fixture evidence, not a real judgment.')
                write_export()
                self.assertEqual(validated_export(export, 'A', 'development')['pair']['grade'], 2)
                row['job_id'] = 'changed'
                write_export()
                with self.assertRaises(ValueError):
                    validated_export(export, 'A', 'development')


if __name__ == '__main__':
    unittest.main()
