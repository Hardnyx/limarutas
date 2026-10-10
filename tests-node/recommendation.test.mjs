import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRecommendation } from '../assets/js/tripRecommendation.js';

test('explanations distinguish convenience from speed without changing ranking', () => {
  assert.match(explainRecommendation({ transfers: 0, walkM: 600 }), /Sin transbordo/);
  assert.match(explainRecommendation({ transfers: 1, minutes: 45 }, {
    directReference: { minutes: 80 }, savingThreshold: 20
  }), /35 min/);
  assert.match(explainRecommendation({ transfers: 1, minutes: 75 }, {
    directReference: { minutes: 80 }, savingThreshold: 20
  }), /Equilibra/);
  assert.match(explainRecommendation({ transfers: 1 }, { winningIntegrated: true }), /integrados/);
});
