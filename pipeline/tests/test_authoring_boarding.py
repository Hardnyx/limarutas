import copy
import unittest
from pipeline.tests.test_authoring_terminals import fixture
from pipeline.authoring.terminals import build
from pipeline.authoring.boarding import apply_boarding
from pipeline.scripts.trips.build_trip_graph import update_feeder_routes

class BoardingTest(unittest.TestCase):
    def setup_fixture(self):
        net,station,service,evidence=fixture()
        source,_=build({'services':{'AN-18':service}},'terminal',station,net,evidence)
        collection={'type':'FeatureCollection','features':[{'id':'source-example','type':'Feature',
            'properties':{'status':'current','point_type':'boarding_platform','route_name':'Ejemplo',
                'osm_node':200,'boarding_number':6,'route_code':'AN-02'},
            'geometry':{'type':'Point','coordinates':net.nodes[1]}}]}
        return source,collection,station,net,evidence

    def test_match_by_name_keep_internal_identity_and_arrival_exactly(self):
        source,collection,station,net,evidence=self.setup_fixture()
        original=copy.deepcopy(source)
        result,report=apply_boarding(source,collection,station,net,evidence,{'sha256':'fixture','file':'fixture'})
        self.assertEqual(source,original)
        svc=result['services']['AN-18']
        self.assertEqual(svc['vuelta'],source['services']['AN-18']['vuelta'])
        self.assertEqual(svc['boarding']['routeCode'],'AN-02')
        self.assertEqual(svc['ida']['stops'][0]['id'],'met:terminal')
        self.assertEqual(svc['ida']['stops'][0]['boardingPoint']['coordinates'],net.nodes[1])
        self.assertFalse(report['arrivalGeometryChanged'])
        self.assertEqual(apply_boarding(result,collection,station,net,evidence,{'sha256':'fixture','file':'fixture'})[0],result)

    def test_reject_ambiguous_or_wrong_platform_without_writing(self):
        source,collection,station,net,evidence=self.setup_fixture()
        before=copy.deepcopy(source)
        collection['features'][0]['geometry']['coordinates']=[-77.01,-12]
        with self.assertRaises(ValueError):apply_boarding(source,collection,station,net,evidence,{})
        self.assertEqual(source,before)
        collection['features'][0]['geometry']['coordinates']=net.nodes[1]
        collection['features'].append(copy.deepcopy(collection['features'][0]))
        with self.assertRaises(ValueError):apply_boarding(source,collection,station,net,evidence,{})

    def test_graph_separates_boarding_preserves_shared_station_and_arrival(self):
        source,collection,station,net,evidence=self.setup_fixture()
        result,_=apply_boarding(source,collection,station,net,evidence,{})
        svc=result['services']['AN-18']
        terminal=svc['ida']['stops'][0];end=svc['ida']['stops'][1]
        graph={'stops':[[terminal['lat'],terminal['lon'],terminal['name'],0],
                        [end['lat'],end['lon'],end['name'],0]],
            'routes':{'alim:AN-18:ida':[0,1],'alim:AN-18:vuelta':[1,0],'met:B:ns':[0,1]},'segM':{}}
        before=copy.deepcopy(graph)
        update_feeder_routes(graph,{'AN-18':svc},['AN-18'],True)
        self.assertEqual(graph['stops'][:2],before['stops'])
        self.assertEqual(graph['routes']['met:B:ns'],[0,1])
        self.assertEqual(graph['routes']['alim:AN-18:vuelta'],[1,0])
        self.assertEqual(graph['routes']['alim:AN-18:ida'],[2,1])
        copied=copy.deepcopy(graph)
        update_feeder_routes(graph,{'AN-18':svc},['AN-18'],True)
        self.assertEqual(graph,copied)
