"""Explicit order and prerequisites for derived data; acquisition stays separate."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Stage:
    script: str
    dependencies: tuple[str, ...] = ()
    inputs: tuple[str, ...] = ()


PBF = 'data/raw/osm/Lima.osm.pbf'
STAGES = {
    'stops': Stage('wikiroutes/wr_build_stops_index.py', inputs=('pipeline/output/wr_map.json',)),
    'crossings': Stage('wikiroutes/wr_stops_cruces.py', ('stops',), ('pipeline/output/wr_stops_index.json', PBF)),
    'met-paths': Stage('metropolitano/build_met_paths.py', inputs=(
        'data/processed/metropolitano/metropolitano.json',
        'data/processed/metropolitano/metropolitano_services.json',
        'data/processed/metropolitano/metropolitano_stops.json')),
    'feeders': Stage('metropolitano/build_alim_paths.py', ('crossings', 'met-paths'), (
        PBF, 'data/raw/osm/transporte.zip', 'pipeline/output/wr_stops_index.json',
        'data/processed/metropolitano/alimentadores.json', 'config/alim_paraderos.json', 'config/alim_trazados.json')),
    'tracks': Stage('osm/build_recorridos.py', ('stops',), (PBF, 'pipeline/output/wr_map.json')),
    'walk': Stage('osm/build_walk_graph.py', inputs=(PBF, 'data/processed/metropolitano/metropolitano_stops.json')),
    'trips': Stage('trips/build_trip_graph.py', ('crossings', 'met-paths', 'feeders'), (
        PBF, 'pipeline/output/wr_map.json', 'pipeline/output/prr_fichas.json',
        'data/processed/metropolitano/metropolitano_paths.json',
        'data/processed/metropolitano/alimentadores_paths.json', 'data/processed/metro/metro.geojson')),
}


def stage_order(target, with_dependencies=False):
    result, visiting = [], set()

    def visit(name):
        if name in result:
            return
        if name in visiting:
            raise ValueError(f'Cyclic pipeline dependency: {name}')
        visiting.add(name)
        if with_dependencies:
            for dependency in STAGES[name].dependencies:
                visit(dependency)
        visiting.remove(name)
        result.append(name)

    visit(target)
    return result
