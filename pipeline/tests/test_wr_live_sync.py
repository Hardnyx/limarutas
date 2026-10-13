import copy
from types import SimpleNamespace
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline.scripts.wikiroutes.wr_catalog_live import parse
from pipeline.scripts.wikiroutes.wr_compare import detect_trips,color_update,stop_changes,match_trips,merge_metadata
from pipeline.scripts.wikiroutes.wr_geometry_diff import compare,digest
from pipeline.scripts.wikiroutes.wr_sync_live import ROOT,compare_route,folder,summarize,apply_safe

POLICY=json.loads((ROOT/'config/wikiroutes_sync.json').read_text())

def track(points):return {'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'LineString','coordinates':points},'properties':{}}]}
A=track([[-77,-12],[-76.99,-12],[-76.98,-12]])

class LiveSyncTest(unittest.TestCase):
    def test_catalog_keeps_inactive_records_and_deduplicates_by_id(self):
        html='<a class="tag-btn no-active hidden" title="123" href="/es/lima?routes=1">123</a>'
        records=parse(html*2);self.assertEqual(len(records),1);self.assertFalse(records[0]['active'])
        with self.assertRaises(ValueError):parse('<html>Error</html>')

    def test_all_trips_detected_and_derived_files_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            for n in ['route_track_trip1.geojson','route_track_trip4.geojson','route_track_trip4.osm.geojson','route_track_trip4.vias.json']:Path(directory,n).touch()
            self.assertEqual(detect_trips(directory),[1,4])

    def test_colors_keep_real_values_and_improve_only_placeholders(self):
        self.assertEqual(color_update('#888888','rgb(255, 0, 0)'), '#FF0000')
        self.assertEqual(color_update('#123456','#FF0000'),'#123456')
        self.assertEqual(color_update('#123456','#888888'),'#123456')
        self.assertEqual(color_update('#888888','bad'),'#888888')
        self.assertEqual(color_update('#888888','rgba(0, 0, 0, 0)'),'#888888')

    def test_redraw_density_and_reverse_direction_keep_same_path(self):
        kind,metrics,_=compare(A,track([[-76.98,-12],[-76.985,-12],[-76.99,-12],[-76.995,-12],[-77,-12]]),POLICY)
        self.assertEqual(kind,'UNCHANGED');self.assertTrue(metrics['orientation_reversed'])

    def test_deleted_return_leg_fails_bidirectional_coverage(self):
        old=track([[-77,-12],[-76.99,-12],[-76.99,-12.01]])
        kind,_,_=compare(old,track([[-77,-12],[-76.99,-12]]),POLICY)
        self.assertEqual(kind,'MAJOR_CHANGE')

    def test_swapped_trip_order_matches_source_endpoints(self):
        b=track([[-77,-12.01],[-76.98,-12.01]])
        self.assertEqual(match_trips({1:A,2:b},[{'trip':1,'geometry':b},{'trip':2,'geometry':A}]),{1:2,2:1})

    def test_stop_identity_distinguishes_all_change_types(self):
        old=[{'id':'1','name':'A','coordinates':[-77,-12]},{'id':'2','name':'B','coordinates':[-76.99,-12]},{'id':'3','name':'C','coordinates':[-76.98,-12]}]
        new=[{'id':'2','name':'X','coordinates':[-76.98,-12]},{'id':'1','name':'A','coordinates':[-77,-12]},{'id':'4','name':'D','coordinates':[-76.97,-12]}]
        self.assertEqual({c['type'] for c in stop_changes(old,new,POLICY)}, {'STOP_ADDED','STOP_REMOVED','STOP_RENAMED','STOP_REORDERED','STOP_MOVED'})

    def test_metadata_merge_preserves_authoring_flags_and_custom_fields(self):
        entry={'folder':'data/processed/transporte/route_1','trip':4,'osm':True,'color':'#123456','name':'Manual','custom':{'keep':True},'wikiroutes':{'review_note':'keep'}}
        result=merge_metadata(entry,'1',{'url':'https://wikiroutes.info/es/lima?routes=1','title':'Live','color_live':'#FF0000','checked_at':'now'},2)
        for k,v in entry.items():
            if k!='wikiroutes':self.assertEqual(result[k],v)
        self.assertEqual(result['wikiroutes']['review_note'],'keep')
        self.assertEqual(result['wikiroutes']['live_trip'],2)

    def test_accepted_source_is_not_written_and_geometry_needs_review(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);directory=folder(root,'1');directory.mkdir(parents=True)
            (directory/'route_track_trip1.geojson').write_text(json.dumps(A))
            (directory/'stops_trip1.geojson').write_text(json.dumps({'features':[]}))
            (directory/'route_track_trip1.route.json').write_text('{"review":{"accepted":true}}')
            wr={'routes':{'x':{'folder':directory.relative_to(root).as_posix(),'trip':1,'color':'#888888','osm':True}}}
            before={p:p.read_bytes() for p in directory.iterdir()}
            snapshot={'trips':[{'trip':1,'geometry':track([[-77,-12.1],[-76.98,-12.1]]),'stops':[]}],'color_live':'#FF0000'}
            report,_=compare_route(root,{'route_id':'1','active':True},snapshot,wr,POLICY)
            self.assertEqual(report['layers'][0]['classification'],'NEEDS_REVIEW')
            self.assertFalse(report['layers'][0]['safe_to_apply']['geometry'])
            self.assertEqual(before,{p:p.read_bytes() for p in directory.iterdir()})

    def test_summary_does_not_report_default_or_missing_colors_as_real_changes(self):
        def layer(old,live,safe=False):return {'old_color':old,'live_color':live,'safe_to_apply':{'color':safe},'classification':'UNCHANGED','stop_changes':[]}
        records={'1':{'layers':[layer('#888888','#00008C'),layer('#123456',None),layer('#123456','#FEDCBA'),layer('#888888','#FEDCBA',True)]}}
        summary=summarize([{'route_id':'1'}],{'1'},records,True)
        self.assertEqual(summary['changed_real_colors'],1)
        self.assertEqual(summary['placeholder_to_live_layers'],1)

    def application_fixture(self,root):
        directory=folder(root,'1');directory.mkdir(parents=True)
        (directory/'route_track_trip1.geojson').write_text(json.dumps(A))
        (directory/'stops_trip1.geojson').write_text(json.dumps({'features':[]}))
        (directory/'route_track_trip1.route.json').write_text('{"review":{"accepted":true}}')
        wr={'routes':{'x':{'folder':directory.relative_to(root).as_posix(),'trip':1,'color':'#888888','osm':True,'custom':'keep'}}}
        (root/'pipeline/output').mkdir(parents=True)
        (root/'pipeline/output/wr_map.json').write_text(json.dumps(wr))
        (root/'pipeline/output/trip_graph.json').write_text('graph sentinel')
        (root/'config').mkdir();(root/'config/wr_overrides.json').write_text('{"1":{"color":"#888888","manual":"keep"}}')
        snapshot={'url':'https://wikiroutes.info/es/lima?routes=1','title':'Live','checked_at':'2026-10-13T15:00:00+00:00',
                  'trips':[{'trip':1,'geometry':A,'stops':[],'color':'rgb(255, 0, 0)'}],'color_live':'#FF0000'}
        report,_=compare_route(root,{'route_id':'1','active':True},snapshot,wr,POLICY)
        cache=root/'pipeline/temp/scan';(cache/'route_1').mkdir(parents=True)
        (cache/'route_1/snapshot.json').write_text(json.dumps(snapshot))
        (cache/'changes.json').write_text(json.dumps({'summary':{'scan_complete':True},'local_catalog_hash':digest(wr),'routes':{'1':report}}))
        return SimpleNamespace(root=root,snapshot=cache),directory

    def test_safe_application_preserves_tracks_sidecar_stops_graph_and_custom_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);args,directory=self.application_fixture(root)
            before={p:p.read_bytes() for p in directory.iterdir()}
            with patch('pipeline.validation.validate_site'):apply_safe(args)
            self.assertEqual(before,{p:p.read_bytes() for p in directory.iterdir()})
            self.assertEqual((root/'pipeline/output/trip_graph.json').read_text(),'graph sentinel')
            entry=json.loads((root/'pipeline/output/wr_map.json').read_text())['routes']['x']
            self.assertEqual(entry['color'],'#FF0000');self.assertEqual(entry['custom'],'keep');self.assertTrue(entry['osm'])
            self.assertEqual(json.loads((root/'config/wr_overrides.json').read_text())['1']['manual'],'keep')

    def test_failed_application_rolls_back_its_catalog_and_new_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);args,_=self.application_fixture(root);path=root/'pipeline/output/wr_map.json';before=path.read_bytes()
            with patch('pipeline.validation.validate_site',side_effect=[None,ValueError('failed final check')]):
                with self.assertRaises(ValueError):apply_safe(args)
            self.assertEqual(path.read_bytes(),before)
            self.assertFalse((root/'pipeline/output/wikiroutes_manifest.json').exists())

    def test_folder_traversal_rejected(self):
        with self.assertRaises(ValueError):folder(ROOT,'../../outside')
