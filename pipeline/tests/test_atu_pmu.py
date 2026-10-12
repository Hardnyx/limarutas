import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline.scripts.atu import sources, sync_geovisor
from pipeline.scripts.atu.build_pmu import build, validate
from pipeline.validation import validate_graph
ROOT=Path(__file__).resolve().parents[2]

class PMUTest(unittest.TestCase):
    def setUp(self):
        self.collection=json.loads((ROOT/'data/raw/atu_geovisor/pmu_sit.geojson').read_text())
        self.raw=sources.json_bytes(self.collection)
        self.entry={'sha256':sources.sha(self.raw),'url':sources.URLS['pmu']}

    def test_official_parts_and_base_state_are_preserved_without_stations(self):
        red,catalog,inventory=build(self.collection,self.entry)
        originals={sources.identity('pmu',f['properties']):f for f in self.collection['features']}
        for feature in red['features']:
            p=feature['properties']
            self.assertEqual(feature['geometry'],originals[p['source_identity']]['geometry'])
            self.assertFalse(p['ruteable']);self.assertFalse(p['operativo'])
        self.assertEqual(catalog['stationPoints'],0)
        self.assertEqual(len(red['features']),len(originals))
        reordered=copy.deepcopy(self.collection);reordered['features'].reverse()
        self.assertEqual(build(reordered,self.entry)[0],red)

    def test_station_names_are_cited_without_points_or_operating_l2_stations(self):
        red,_,_=build(self.collection,self.entry)
        references=[f['properties']['station_reference'] for f in red['features'] if 'station_reference' in f['properties']]
        self.assertEqual({r['line']:len(r['stations']) for r in references},
                         {'L2':22,'L3':28,'L4 ramal':8,'L4 continuación':20})
        for reference in references:
            self.assertFalse(reference['coordinatesPublished'])
            self.assertTrue(reference['sourceUrl'].startswith('https://'))
            for station in reference['stations']:
                self.assertNotIn('coordinates',station)
                self.assertNotEqual(station['status'],'operativa')

    def test_invalid_response_and_ambiguous_schema_fail(self):
        for raw in [b'<html>Error</html>',b'{"type":"Feature"}',b'{"type":"FeatureCollection","features":[]}']:
            with self.assertRaises(ValueError):sources.inspect('pmu',raw)
        changed=copy.deepcopy(self.collection);changed['features'][0]['properties']['tecnologia']='Unknown new type'
        with self.assertRaises(ValueError):build(changed,self.entry)
        changed=copy.deepcopy(self.collection);changed['features'][0]['geometry']['coordinates'][0][0]=[float('nan'),-12]
        with self.assertRaises(ValueError):build(changed,self.entry)

    def test_geometry_diff_and_order_independence(self):
        before=copy.deepcopy(self.collection);after=copy.deepcopy(before)
        after['features'].reverse()
        self.assertFalse(sources.compare('pmu',before,after)['dataChanged'])
        after['features'][0]['geometry']['coordinates'][0][0][0]+=.00001
        after['features'][1]['properties']['long_km']+=1
        change=sources.compare('pmu',before,after)
        self.assertEqual(len(change['geometryChanged']),1);self.assertEqual(len(change['attributesChanged']),1)
        after['features'].pop()
        self.assertEqual(len(sources.compare('pmu',before,after)['removed']),1)

    def test_never_put_project_in_operational_graph(self):
        graph={'version':1,'stops':[[-12,-77,'A',0],[-12.1,-77,'B',0]],'districts':['Lima'],
            'routes':{'pmu:metro:l3':[0,1]}}
        with self.assertRaisesRegex(ValueError,'Projected'):validate_graph(graph)

    def test_conditional_sync_and_failure_preserve_last_good(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            with patch.object(sources,'fetch',return_value=(200,{'etag':'v1'},self.raw)):
                first=sources.sync(state,names=('pmu',))
            self.assertTrue(first['success'])
            pointer=(state/'current.json').read_bytes()
            with patch.object(sources,'fetch',return_value=(304,{},b'')) as request:
                second=sources.sync(state,names=('pmu',))
                self.assertEqual(request.call_args.args[1]['If-None-Match'],'v1')
            self.assertFalse(second['processingRequired']);self.assertEqual(second['downloadedBytes'],0)
            self.assertEqual((state/'current.json').read_bytes(),pointer)
            with patch.object(sources,'fetch',return_value=(200,{},b'<html>Error</html>')):
                failed=sources.sync(state,names=('pmu',))
            self.assertFalse(failed['success']);self.assertEqual((state/'current.json').read_bytes(),pointer)

    def test_raw_geometry_corruption_and_duplicate_ids_are_rejected(self):
        red,_,_=build(self.collection,self.entry)
        red['features'][0]['geometry']['coordinates'][0][0][0]+=.001
        with self.assertRaises(ValueError):validate(red,self.collection,self.entry)
        red,_,_=build(self.collection,self.entry);red['features'][1]['id']=red['features'][0]['id']
        with self.assertRaises(ValueError):validate(red,self.collection,self.entry)

    def test_sync_publication_is_idempotent_and_invalid_transform_never_promotes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);raw=root/'raw';out=root/'out'
            with patch.object(sync_geovisor,'ROOT',root),patch.object(sync_geovisor,'RAW',raw),patch.object(sync_geovisor,'OUT',out),patch.object(sync_geovisor,'REPORT',root/'report.json'):
                with patch.object(sources,'fetch',return_value=(200,{'etag':'v1'},self.raw)):
                    sync_geovisor.update(root/'state')
                before={p.relative_to(root):p.read_bytes() for base in [raw,out,root/'docs',root/'pipeline/output'] for p in base.rglob('*') if p.is_file()}
                with patch.object(sources,'fetch',return_value=(304,{},b'')):
                    self.assertFalse(sync_geovisor.update(root/'state')['processingRequired'])
                self.assertTrue(all((root/p).read_bytes()==body for p,body in before.items()))
                small=copy.deepcopy(self.collection);small['features']=small['features'][:1]
                with patch.object(sources,'fetch',return_value=(200,{},sources.json_bytes(small))):
                    with self.assertRaisesRegex(ValueError,'50 %'):sync_geovisor.update(root/'state')
                self.assertTrue(all((root/p).read_bytes()==body for p,body in before.items()))
                bad=copy.deepcopy(self.collection);bad['features'][0]['properties']['tecnologia']='Unmapped technology'
                with patch.object(sources,'fetch',return_value=(200,{},sources.json_bytes(bad))):
                    with self.assertRaises(ValueError):sync_geovisor.update(root/'state')
                self.assertTrue(all((root/p).read_bytes()==body for p,body in before.items()))
                self.assertFalse(json.loads((root/'report.json').read_text())['success'])

    def test_failed_replacement_restores_every_published_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);paths=[root/'raw.geojson',root/'processed.geojson',root/'manifest.json']
            for path in paths[:2]:path.write_bytes(b'previous')
            actual=sync_geovisor.atomic_bytes
            failed=False
            def replace(path,body):
                nonlocal failed
                if path==paths[2] and not failed:
                    failed=True
                    raise OSError('simulated disk failure')
                actual(path,body)
            with patch.object(sync_geovisor,'atomic_bytes',side_effect=replace):
                with self.assertRaises(OSError):sync_geovisor.publish({p:b'new' for p in paths})
            self.assertEqual([p.read_bytes() for p in paths[:2]],[b'previous',b'previous'])
            self.assertFalse(paths[2].exists())
