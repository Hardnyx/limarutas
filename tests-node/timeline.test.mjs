import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, clockText } from '../assets/js/tripTimeline.js';

test('timeline accounts for walks, boarding waits, station exits and transfers across midnight', () => {
  const option = { minutes: 49, legs: [
    { type: 'walk', m: 75, travelMinutes: 1.3 },
    { type: 'ride', route: { stops: [1, 2, 3, 4] }, from: 0, to: 3, travelMinutes: 12, segmentMinutes: [4, 4, 4], wait: 4, transferMinutes: 0 },
    { type: 'walk', m: 150, travelMinutes: 2.6 },
    { type: 'ride', route: { stops: [5, 6, 7] }, from: 0, to: 2, travelMinutes: 20, segmentMinutes: [10, 10], wait: 2, transferMinutes: 3, exitMin: 4 },
    { type: 'walk', m: 0, travelMinutes: 0 }
  ] };
  const timeline = buildTimeline(option, 1430);
  assert.ok(Math.abs(timeline.calculatedMinutes - 48.9) < 1e-8);
  const points = timeline.rows.filter(row => row.type === 'point');
  assert.deepEqual(points.map(row => row.clock), ['23:50', '23:55', '00:07 +1d', '00:19 +1d', '00:39 +1d', '00:39 +1d']);
  assert.equal(points.at(-1).offset, option.minutes);
  assert.ok(points.every((point, i) => !i || point.offset >= points[i - 1].offset));
  assert.deepEqual(timeline.rows.filter(row => row.type === 'ride').map(row => row.intermediate.map(stop => stop.stop)), [[2, 3], [6]]);
  assert.equal(timeline.rows.find(row => row.type === 'walk' && row.exit).minutes, 6.6);
  assert.equal(timeline.rows.find(row => row.type === 'wait' && row.transfer).minutes, 5);
  assert.equal(clockText(1440), '00:00 +1d');
});
