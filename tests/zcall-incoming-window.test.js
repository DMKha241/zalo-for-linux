'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EngineCore } = require('../zcall-native/native-engine/engine-core');
const { ElectronCallUi } = require('../zcall-native/native-engine/ui-client');

function setup() {
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.shown = false;
      this.messages = [];
      this.webContents = new EventEmitter();
      this.webContents.send = (...args) => this.messages.push(args);
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    showInactive() { assert.equal(this.destroyed, false); this.shown = true; }
    setMenuBarVisibility() {}
    setAlwaysOnTop() {}
    moveTop() {}
    flashFrame() {}
    setBounds() {}
    loadFile() {}
  }
  const electron = {
    BrowserWindow,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
  };
  const filename = path.join(__dirname, '../plugins/zcall/incoming.js');
  const sandbox = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    require: (name) => name === 'electron' ? electron : require(name),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const incoming = sandbox.module.exports;
  // Exercise the real engine -> UI protocol without opening a socket or desktop.
  const ui = Object.assign(Object.create(ElectronCallUi.prototype), {
    cb: {}, incomingCb: null, state: null, fallback: null,
    sock: {
      destroyed: false,
      write(line) {
        const message = JSON.parse(line);
        if (message.type === 'state' && message.phase === 'incoming') incoming.show(message, '/assets');
        if (message.type === 'close') incoming.close();
      },
    },
  });
  const engine = new EngineCore({ emit() {}, ui });
  const control = (act, callId) => engine.onZaloFrame({ type: 'control', data: { act, data: { callId } } });
  return { incoming, windows, ui, engine, control };
}

test('remote cancellation stops and destroys a visible ringing notice', () => {
  const { incoming, windows, ui, engine, control } = setup();
  control('request', 123);
  const notice = windows[0];
  notice.webContents.emit('did-finish-load');
  assert.equal(notice.shown, true);
  assert.equal(notice.messages[0][0], 'zcall-incoming-state');
  control('cancel', 123);
  assert.equal(notice.messages.at(-1)[0], 'zcall-incoming-stop');
  assert.equal(notice.destroyed, true);
  assert.equal(incoming.isOpen(), false);
  assert.equal(ui.incomingCb, null);
  ui._onAction({ action: 'accept' });
  assert.equal(engine.call, null);
});

test('cancellation during page load cannot show the notice afterwards', () => {
  const { incoming, windows, control } = setup();
  control('request', 123);
  const notice = windows[0];
  control('cancel', 123);
  assert.equal(notice.destroyed, true);
  assert.doesNotThrow(() => notice.webContents.emit('did-finish-load'));
  assert.equal(notice.shown, false);
  assert.equal(incoming.isOpen(), false);
});

test('callbacks from a cancelled notice cannot affect the next incoming call', () => {
  const { incoming, windows, control } = setup();
  control('request', 123);
  const old = windows[0];
  control('cancel', 123);
  control('request', 456);
  const next = windows[1];
  old.webContents.emit('did-finish-load');
  old.emit('closed');
  assert.equal(next.shown, false);
  assert.equal(incoming.isOpen(), true);
  next.webContents.emit('did-finish-load');
  assert.equal(next.shown, true);
  control('cancel', 456);
  assert.equal(next.destroyed, true);
  assert.equal(incoming.isOpen(), false);
});
