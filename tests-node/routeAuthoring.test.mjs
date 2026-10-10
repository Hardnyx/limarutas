import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteEditorState } from '../assets/js/routeAuthoringState.js';

const pack = (name, revision = 0) => ({ route: { name, revision, review: { accepted: false } }, validation: { ready: true }, coordinates: [] });
test('editor undo and cancel retain the persisted revision without losing source snapshots', () => {
  const state = new RouteEditorState(); state.load(pack('original'));
  state.change(pack('edited')); state.markSaved(pack('edited',1));
  state.undo(); assert.equal(state.pack.route.name, 'original'); assert.equal(state.requestRoute().revision,1);
  state.redo(); assert.equal(state.pack.route.name,'edited');
  state.change(pack('discarded')); state.cancel();
  assert.equal(state.pack.route.name,'edited'); assert.equal(state.dirty,false);
  assert.equal(state.past.length,0);
});
