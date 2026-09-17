import unittest
from models.prepare_training_today import split,Extractor
from models.taxonomy import Taxonomy,Skill
from models.train_skill_tagger import spans,metrics
import numpy as np

class TrainingChecks(unittest.TestCase):
    def test_split_deterministic(self):
        self.assertEqual(split('same-identity'),split('same-identity'))
        self.assertEqual({split(str(i)) for i in range(1000)}, {'train','dev','test'})
    def test_extractor_boundaries_and_longest(self):
        tax=Taxonomy(alias_to_skill={'java':'a','java programming':'b','sql':'c'})
        e=Extractor(tax)
        self.assertEqual(e('Java programming and SQL, not javascript'),['b','c'])
    def test_spans_adjacent_and_orphan(self):
        self.assertEqual(spans(['O','B','I','B','O','I']),{(1,3),(3,4),(5,6)})
    def test_metrics_ignore_subtokens(self):
        target=np.array([[0,3,-100,6,0]])
        pred=np.zeros((1,5,9))
        for i,v in enumerate([0,3,8,6,0]):pred[0,i,v]=1
        result=metrics((pred,target))
        self.assertEqual(result['skill_f1'],1.)
        self.assertEqual(result['knowledge_f1'],0.)
if __name__=='__main__':unittest.main()
