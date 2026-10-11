"""Compile via-way turn restrictions into directed segment sequences."""
import math
from collections import defaultdict

KINDS = {'no_left_turn', 'no_right_turn', 'no_straight_on', 'no_u_turn',
         'only_left_turn', 'only_right_turn', 'only_straight_on', 'only_u_turn',
         'no_entry', 'no_exit'}


def compile_via(network, restriction):
    """Resolve the unique topology, independent of relation member order."""
    groups = {}
    for way in [restriction['from'], *restriction['viaWays'], restriction['to']]:
        edges = sorted((network.edges[eid] for eid in network.ways.get(way, [])),
                       key=lambda edge: int(edge['id'].split(':')[1]))
        if not edges or any(a['nodes'][1] != b['nodes'][0] for a, b in zip(edges, edges[1:])):
            return None
        groups[way] = edges
    if len(restriction['viaWays']) > 12:
        return None
    first, last = groups[restriction['from']], groups[restriction['to']]
    starts = [(first[0]['nodes'][0], (first[0]['id'], -1)),
              (first[-1]['nodes'][1], (first[-1]['id'], 1))]
    ends = {last[0]['nodes'][0]: (last[0]['id'], 1),
            last[-1]['nodes'][1]: (last[-1]['id'], -1)}
    solutions = []

    def visit(node, remaining, tokens):
        if not remaining:
            if node in ends:
                solutions.append(tokens + [ends[node]])
            return
        for way in remaining:
            edges = groups[way]
            for sign in (1, -1):
                entry = edges[0]['nodes'][0] if sign == 1 else edges[-1]['nodes'][1]
                exit_node = edges[-1]['nodes'][1] if sign == 1 else edges[0]['nodes'][0]
                if entry != node or entry == exit_node:
                    continue
                sequence = edges if sign == 1 else list(reversed(edges))
                visit(exit_node, [w for w in remaining if w != way],
                      tokens + [(edge['id'], sign) for edge in sequence])

    for node, token in starts:
        visit(node, restriction['viaWays'], [token])
    def contains_nodes(tokens):
        nodes = {node for eid, _ in tokens for node in network.edges[eid]['nodes']}
        return set(restriction.get('viaNodes', [])) <= nodes
    unique = {tuple(tokens) for tokens in solutions if contains_nodes(tokens)}
    return list(next(iter(unique))) if len(unique) == 1 else None


class RestrictionSequences:
    def __init__(self, network):
        self.patterns, self.starts, self.unresolved = [], defaultdict(list), []
        for restriction in network.data.get('viaRestrictions', []):
            tokens = compile_via(network, restriction)
            if tokens is None:
                self.unresolved.append({**restriction,
                    'ways': [restriction['from'], *restriction['viaWays'], restriction['to']],
                    'reason': 'ambiguous-or-missing-topology'})
                continue
            index = len(self.patterns)
            self.patterns.append({**restriction, 'tokens': tokens})
            self.starts[tokens[0]].append(index)

    def advance(self, state, token):
        following, blocked = set(), []
        for index, position in state:
            pattern = self.patterns[index]
            if pattern['tokens'][position] != token:
                if pattern['kind'].startswith('only_'):
                    blocked.append(pattern['relation'])
                continue
            if position + 1 == len(pattern['tokens']):
                if pattern['kind'].startswith('no_'):
                    blocked.append(pattern['relation'])
            else:
                following.add((index, position + 1))
        for index in self.starts.get(token, []):
            following.add((index, 1))
        return tuple(sorted(following)), blocked

    def trace(self, refs):
        state, previous, violations = (), None, []
        for i, ref in enumerate(refs):
            if ref['type'] != 'street':
                state, previous = (), None
                continue
            token = (ref['edge'], 1 if ref.get('end', 1) > ref.get('start', 0) else -1)
            # Splitting one traversal at an editor anchor is not a second traversal.
            continuation = (previous and previous['edge'] == ref['edge']
                            and previous.get('end', 1) == ref.get('start', 0)
                            and (previous.get('end', 1) > previous.get('start', 0)) == (token[1] == 1))
            if not continuation:
                state, blocked = self.advance(state, token)
                violations.extend({'code': 'restrictedTurn', 'pathIndex': i, 'relation': relation,
                                   'message': 'Movimiento restringido a través de vías intermedias'}
                                  for relation in blocked)
            previous = ref
        return state, violations


def unresolved_applies(restriction, refs, network):
    """Incomplete relations block the approach, not unrelated use of any member."""
    # A known via node limits incomplete/conditional restrictions to that junction.
    # Merely driving along a member way hundreds of metres away is not a turn.
    if restriction.get('viaNodes') and not restriction.get('viaWays'):
        via = set(restriction['viaNodes'])
        previous = None
        for ref in refs:
            if ref['type'] != 'street':
                previous = None
                continue
            edge = network.edges[ref['edge']]
            start, end = ref.get('start', 0), ref.get('end', 1)
            entry = edge['nodes'][0 if end > start else 1] if start in (0, 1) else None
            if previous and entry in via and previous[1] == entry:
                from_way, to_way = restriction.get('from'), restriction.get('to')
                if (from_way is None or previous[0] == from_way) and (to_way is None or edge['way'] == to_way):
                    # An implicit no-left/right-turn with a missing destination
                    # cannot apply to a straight continuation of the same
                    # named street across an OSM way split. Keep the
                    # actual turn unresolved; never infer permission for it.
                    tags = restriction.get('tags', {})
                    kind = tags.get('restriction')
                    if to_way is None and tags.get('implicit') == 'yes' and kind in ('no_left_turn', 'no_right_turn'):
                        a, b = network.coordinates(previous[2])
                        c, d = network.coordinates(ref)
                        scale = math.cos(math.radians(b[1]))
                        h1 = math.atan2(b[1]-a[1], (b[0]-a[0])*scale)
                        h2 = math.atan2(d[1]-c[1], (d[0]-c[0])*scale)
                        turn = math.degrees((h2-h1+math.pi) % (2*math.pi)-math.pi)
                        before_name = network.edges[previous[2]['edge']]['name']
                        if before_name and before_name == edge['name'] and abs(turn) < 10:
                            previous = (edge['way'], edge['nodes'][1 if end > start else 0] if end in (0, 1) else None, ref)
                            continue
                    return True
            previous = (edge['way'], edge['nodes'][1 if end > start else 0] if end in (0, 1) else None, ref)
        return False
    if not restriction.get('from') or not restriction.get('viaWays'):
        return bool({network.edges[r['edge']]['way'] for r in refs if r['type'] == 'street'}
                    & set(restriction['ways']))
    pairs = {(restriction['from'], way) for way in restriction['viaWays']}
    previous = None
    for ref in refs:
        if ref['type'] != 'street':
            previous = None
            continue
        way = network.edges[ref['edge']]['way']
        if (previous, way) in pairs:
            return True
        previous = way
    return False
