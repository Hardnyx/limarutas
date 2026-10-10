import unittest
from pipeline.authoring.engine import Engine
from pipeline.authoring.resolver import AmbiguousPlace, Resolver
from test_authoring_network import fixture_network


class PlaceResolverTest(unittest.TestCase):
    def test_intersection_and_stop_use_real_records(self):
        net = fixture_network()
        resolver = Resolver(Engine(net), [{'id': 'known', 'name': 'Paradero Sur', 'coordinates': net.nodes[3]}])
        result = resolver.resolve({'kind': 'intersection', 'streets': ['Av. Curva', 'Calle Sur']})
        self.assertEqual(result[0]['node'], 3)
        request = resolver.build_request({'anchors': [{'intersection': ['Av. Curva', 'Calle Sur']}],
                                          'stops': [{'catalogId': 'known'}]})
        self.assertEqual(request['stops'][0]['coordinates'], net.nodes[3])
        self.assertEqual(request['anchors'][0]['node'], 3)

    def test_missing_and_ambiguous_places_are_not_guessed(self):
        net = fixture_network()
        resolver = Resolver(Engine(net))
        with self.assertRaises(ValueError):
            resolver.build_request({'anchors': [{'intersection': ['Inexistente', 'Calle Sur']}]})
        net.edges['3:0']['name'] = 'Av. Curva'
        net.names['av curva'].add(3)
        with self.assertRaises(AmbiguousPlace) as error:
            resolver.build_request({'anchors': [{'intersection': ['Av. Curva', 'Calle Sur']}]})
        self.assertEqual(len(error.exception.candidates), 2)
