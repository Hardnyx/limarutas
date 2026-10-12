import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline.authoring.engine import Engine
from pipeline.authoring.itineraries import corridor_edges, matches_definition
from pipeline.authoring.routing import directed_path, guide_ways
from pipeline.authoring.network import Network, normal
from pipeline.authoring.service import Service
from test_authoring_model import fixture_route

class CorridorTest(unittest.TestCase):
    def test_parking_aisles_require_real_bus_membership_and_private_roads_require_permissions(self):
        net,_=fixture_route()
        data=copy.deepcopy(net.data)
        data['serviceTypes']={'1':'parking_aisle'}
        data['edges'][-1]['facility']='restricted_bus_road'
        net=Network(data);ways=set(net.ways);box=net.data['bbox']
        allowed=corridor_edges(net,ways,set(),box,{'mode':'mixed'},set())
        self.assertFalse(any(e['way']==1 for e in allowed))
        self.assertNotIn(data['edges'][-1],allowed)
        with_bus=corridor_edges(net,ways,set(),box,{'mode':'mixed'},{1})
        self.assertTrue(any(e['way']==1 for e in with_bus))

    def test_guide_discovers_unnamed_connector_and_joint_projection_cannot_drive_backwards(self):
        net,_=fixture_route()
        self.assertIn(1,guide_ways(net,[net.nodes[1],net.nodes[3]]))
        isolated=Network({**net.data,'edges':[net.edges['1:0']]})
        with self.assertRaises(ValueError):directed_path(Engine(isolated),[net.nodes[2],net.nodes[1]],'wrong-way')
        self.assertTrue(matches_definition({'tags':{'source':'https://wikiroutes.info/es/lima?routes=153593'}},{'folder':'data/route_153593'}))
        self.assertFalse(matches_definition({'tags':{'source':'https://wikiroutes.info/es/lima?routes=153593'}},{'folder':'data/route_153145'}))

    def test_api_rematch_uses_directed_evidence_and_returns_unaccepted_draft(self):
        net,route=fixture_route()
        route['source']['provenance']={'definition':{'folder':'fixture'}}
        route['itineraryEvidence']={'kind':'directed-source-corridor','relations':[],'facilityPoints':[]}
        route['profile']={'mode':'mixed','system':'Fixture'}
        route['revision']=7
        rebuilt=copy.deepcopy(route);rebuilt['revision']=8;rebuilt['review']['accepted']=True
        with tempfile.TemporaryDirectory() as root:
            service=Service(net,root,Path(root)/'drafts')
            with patch('pipeline.authoring.itineraries.reconstruct',return_value=rebuilt) as matcher:
                result=service.call({'operation':'match','route':route})['result']['route']
            self.assertTrue(matcher.called);self.assertEqual(result['revision'],7)
            self.assertFalse(result['review']['accepted'])
