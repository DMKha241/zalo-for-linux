'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EngineCore } = require('../zcall-native/native-engine/engine-core');

function setup() {
  const frames = [];
  const ui = {
    visible: false,
    closed: 0,
    onHangup() {},
    incoming(_state, accept, reject) { this.visible = true; this.accept = accept; this.reject = reject; },
    close() { this.visible = false; this.closed++; },
  };
  const engine = new EngineCore({ emit: (f) => frames.push(f), ui });
  const control = (act, callId) => engine.onZaloFrame({ type: 'control', data: { act, data: { callId } } });
  return { engine, ui, frames, control };
}

for (const act of ['cancel', 'end_call', 'reject', 'busy']) {
  test(`${act} closes an unanswered incoming call immediately`, () => {
    const { engine, ui, frames, control } = setup();
    control('request', 123);
    assert.equal(ui.visible, true);
    control(act, '123');
    assert.equal(ui.visible, false);
    assert.equal(ui.closed, 1);
    assert.equal(engine.call, null);
    assert.ok(frames.some((f) => f.command === 'callState' && f.data.state === 'free'));
    // A click already queued by the renderer cannot answer a cancelled call.
    ui.accept();
    assert.equal(engine.call, null);
    assert.ok(!frames.some((f) => f.command === 402));
  });

  test(`${act} arriving before request prevents a stale incoming notice`, () => {
    const { engine, ui, frames, control } = setup();
    control(act, '123');
    control('request', 123);
    assert.equal(engine.call, null);
    assert.equal(ui.visible, false);
    assert.equal(frames.length, 0);
  });
}

test('a duplicate request cannot reopen a cancelled incoming call', () => {
  const { engine, ui, control } = setup();
  control('request', 123);
  control('cancel', 123);
  control('request', 123);
  assert.equal(engine.call, null);
  assert.equal(ui.visible, false);
});

test('cancellation for another call leaves the current notice open', () => {
  const { engine, ui, control } = setup();
  control('request', 123);
  control('cancel', 456);
  assert.equal(engine.call.callId, 123);
  assert.equal(ui.visible, true);
  control('cancel', 123);
  control('request', 456);
  assert.equal(engine.call, null);
  control('request', 789);
  assert.equal(engine.call.callId, 789);
  assert.equal(ui.visible, true);
});

test('an end event without an ID still closes the active incoming call', () => {
  const { engine, ui, control } = setup();
  control('request', 123);
  control('cancel');
  assert.equal(engine.call, null);
  assert.equal(ui.visible, false);
  control('request', 123);
  assert.equal(engine.call, null);
});

test('old ended call IDs expire so a reused ID can ring again', (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const { engine, ui, control } = setup();
  control('cancel', 123);
  now += 60001;
  control('request', 123);
  assert.equal(engine.call.callId, 123);
  assert.equal(ui.visible, true);
});
