import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionState } from '../assets/js/selectionState.js';

test('selection and direction have one identity and idempotent notifications', () => {
  const state = createSelectionState(), events = [];
  const off = state.subscribe(e => events.push(e));
  assert.equal(state.get('alim', 'an-01').direction, 'sur');
  assert.equal(state.get('corr', '201').direction, 'ambas');
  assert.equal(state.get('wr', '1240').direction, 'ida');
  state.update('alim', 'AN-01', { selected: true }, { fit: true });
  state.update('alim', 'an-01', { selected: true });
  state.update('alim', 'AN-01', { direction: 'norte' });
  assert.equal(events.length, 2);
  assert.equal(events[0].context.fit, true);
  assert.equal(state.get('alim', 'an-01').direction, 'norte');
  state.update('alim', 'AN-01', { selected: false });
  assert.equal(state.selected().length, 0);
  assert.equal(state.get('alim', 'AN-01').direction, 'norte');
  off();
  state.update('wr', '1240', { selected: true });
  assert.equal(events.length, 3);
});
