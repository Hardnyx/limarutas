import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

test('domain imports stay independent of application, DOM and map adapters', () => {
  const allowed = new Set(['serviceCatalog.js', 'routePolicy.js', 'corridorPolicy.js', 'wrTexts.js',
    'tripGraph.js', 'tripPlanner.js', 'geo.js', 'metSchedule.js', 'selectionState.js', 'tripRecommendation.js']);
  const visited = new Set();
  function inspect(path){
    if (visited.has(path)) return;
    visited.add(path);
    assert.ok(allowed.has(basename(path)), `${basename(path)} crosses the domain boundary`);
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /\b(?:document|window|localStorage)\s*\.|\bL\s*\./);
    for (const [, relative] of source.matchAll(/^\s*(?:import|export)[^;\n]*\bfrom\s*['"](\.[^'"\n]+)['"]/gm)){
      inspect(resolve(dirname(path), relative));
    }
  }
  for (const module of ['serviceCatalog', 'tripGraph', 'tripPlanner', 'selectionState']){
    inspect(resolve(`assets/js/${module}.js`));
  }
});
