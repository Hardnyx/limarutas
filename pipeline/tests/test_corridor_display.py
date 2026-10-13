import copy
import json
import tempfile
import unittest
from pathlib import Path
from pipeline.scripts.atu.corridor_display import build

POLICY={'distance_m':80,'direction_degrees':25,'minimum_run_m':600,'axis_coverage':.65,
        'existing_route_coverage':.8,'winner_margin':.2,'ambiguous_distance_m':25,'sample_m':50}

def feature(coords,code=None):
    return {'id':'axis','type':'Feature','geometry':{'type':'MultiLineString','coordinates':coords},
            'properties':{'modo':'corredor','ref':code}}

class CorridorDisplayTest(unittest.TestCase):
    def run_build(self,axis,routes):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for path,data in [('config/atu_project_styles.json',{'projects':{},'matching_policy':POLICY,'unassigned_label':'Otros'}),
                              ('data/processed/planificado/red.geojson',{'features':[axis]}),
                              ('data/processed/corredores/corredores.json',{'features':routes})]:
                dest=root/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(data))
            return build(root)

    def test_near_total_replacement_keeps_color_and_does_not_change_source(self):
        axis=feature([[[-77,-12],[-76.98,-12]]]);before=copy.deepcopy(axis)
        old=feature([[[-77,-12.0002],[-76.98,-12.0002]]],'404')
        result=self.run_build(axis,[old])['projects']['axis']
        self.assertEqual(result['corridor'],'morado')
        self.assertGreaterEqual(result['existing_route_coverage']['404'],.8)
        self.assertEqual(axis,before)

    def test_crossings_short_coincidences_and_competing_colors_do_not_inherit(self):
        axis=feature([[[-77,-12],[-76.98,-12]]])
        perpendicular=feature([[[-76.99,-12.01],[-76.99,-11.99]]],'201')
        short=feature([[[-77,-12],[-76.997,-12]]],'201')
        red=feature([[[-77,-12],[-76.98,-12]]],'201')
        blue=feature([[[-77,-12.0001],[-76.98,-12.0001]]],'301')
        for routes in [[perpendicular],[short],[red,blue]]:
            self.assertNotIn('axis',self.run_build(axis,routes)['projects'])

    def test_partial_overlap_colors_only_a_segment_and_preserves_multipart_gaps(self):
        axis=feature([[[-77,-12],[-76.98,-12]],[[-76.95,-12],[-76.93,-12]]])
        old=feature([[[-77,-12],[-76.99,-12]]],'201')
        result=self.run_build(axis,[old])['projects']['axis']
        self.assertEqual(result['corridor'],'mixto')
        colored=[r for r in result['segments'] if r['corridor']]
        self.assertTrue(colored);self.assertTrue(all(r['part']==0 for r in colored))
        self.assertLess(colored[0]['end'],1)
        self.assertTrue(all(r['corridor'] is None for r in result['segments'] if r['part']==1))
