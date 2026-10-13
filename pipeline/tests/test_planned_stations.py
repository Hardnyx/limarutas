import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline.scripts.atu.build_planned_stations import CONFIG, LOCATIONS, OUT, build, validate, ROOT
from pipeline.scripts.atu.sources import SourceError
from pipeline.scripts.atu.sync_station_sources import synchronize
from pipeline.scripts.atu.transfer_display import locate


class PlannedStationsTest(unittest.TestCase):
    def setUp(self):
        self.config=json.loads(CONFIG.read_text())
        self.locations=json.loads(LOCATIONS.read_text())
        self.red=json.loads((OUT/'red.geojson').read_text())

    def test_documented_counts_pending_points_and_operating_links(self):
        before=copy.deepcopy(self.red)
        catalog,files=build(self.config,self.locations,self.red)
        self.assertEqual(catalog['counts']['estacion'],90)
        self.assertEqual(catalog['counts']['centro_transferencia'],25)
        self.assertEqual(catalog['counts']['nodo_dot'],44)
        self.assertEqual(len(catalog['operating_station_links']),5)
        l2=[r for r in catalog['records'] if r['lineas']==['L2']]
        self.assertFalse({20,21,22,23,24}&{r['sequence'] for r in l2})
        pending=[r for r in catalog['records'] if not r['geometry']]
        self.assertGreater(len(pending),0)
        visible=json.loads(files[OUT/'estaciones.geojson'])['features']
        self.assertFalse({r['id'] for r in pending}&{f['id'] for f in visible})
        self.assertEqual(self.red,before)
        self.assertEqual(build(self.config,self.locations,self.red)[1],files)

    def test_independent_identities_and_preserved_source_points(self):
        catalog,_=build(self.config,self.locations,self.red)
        condes=[r for r in catalog['records'] if r['nombre']=='Conde de San Isidro']
        self.assertEqual(len(condes),2)
        self.assertNotEqual(condes[0]['geometry'],condes[1]['geometry'])
        self.assertTrue(all(r['interchange_group'] is None for r in condes))
        for r in catalog['records']:
            self.assertFalse(r['plannerEligible'])
            if r['geometry']:
                self.assertEqual(r['geometry'],self.locations['locations'][r['id']]['geometry'])
                self.assertEqual(r['geometry'],r['source_geometry'])
                if r['display_geometry']:
                    self.assertIn(r['tipo'],['centro_transferencia','nodo_intermodal'])
                    self.assertEqual(r['display_adjustment']['method'],'linked_axis_intersection')
                if r['location_method']=='documented_intersection':self.assertEqual(r['coordinate_role'],'intersection_reference')

    def test_new_source_revision_cannot_reuse_old_digitization(self):
        self.config['sources']['san-isidro-tsv05']['sha256']='new-source'
        with self.assertRaises(SourceError):build(self.config,self.locations,self.red)

    def test_transfer_display_preserves_documentary_point_and_matches_both_axes(self):
        catalog,files=build(self.config,self.locations,self.red)
        record=next(r for r in catalog['records'] if r['id']=='planificado:centro_transferencia:gamarra')
        self.assertNotEqual(record['geometry'],record['display_geometry'])
        self.assertEqual(record['geometry'],record['source_geometry'])
        point=next(f for f in json.loads(files[OUT/'centros_transferencia.geojson'])['features'] if f['id']==record['id'])
        self.assertEqual(point['geometry'],record['display_geometry'])
        self.assertEqual(len(record['display_adjustment']['axis_ids']),2)

    def test_crossing_does_not_create_a_transfer_without_documentary_link(self):
        axes={f['id']:f for f in self.red['features']}
        record={'tipo':'estacion','project_ids':list(axes),'geometry':{'type':'Point','coordinates':[-77.01299,-12.06096]}}
        self.assertIsNone(locate(record,axes,{'id':'test','max_displacement_m':1500}))
        record['tipo']='centro_transferencia';record['project_ids']=record['project_ids'][:1]
        self.assertIsNone(locate(record,axes,{'id':'test','max_displacement_m':1500}))

    def test_operating_flags_swapped_axes_and_pending_dummy_points_rejected(self):
        catalog,_=build(self.config,self.locations,self.red)
        for mutate in [lambda r:r.update(operativo=True),
                       lambda r:r.update(geometry={'type':'Point','coordinates':[-12,-77]}),
                       lambda r:r.update(geometry={'type':'Point','coordinates':[0,0]})]:
            candidate=copy.deepcopy(catalog);mutate(candidate['records'][0])
            with self.assertRaises(SourceError):validate(candidate,self.red)

    def test_unavailable_document_retains_reviewed_coordinates(self):
        before=copy.deepcopy(self.locations)
        with tempfile.TemporaryDirectory() as directory,patch('urllib.request.urlopen',side_effect=OSError('offline')):
            report=synchronize(self.config,Path(directory))
        self.assertFalse(report['publication_changed'])
        self.assertFalse(report['automatic_geocoding'])
        self.assertTrue(all(s['last_good_preserved'] for s in report['sources'].values()))
        self.assertEqual(self.locations,before)


if __name__=='__main__':unittest.main()
