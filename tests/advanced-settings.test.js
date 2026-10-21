'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { createStore } = require('../plugins/advanced-settings/store');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-settings-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('sound settings persist independently, reset, and encode special characters in file URLs', (t) => {
  const directory = temporaryDirectory(t);
  const ringtone = path.join(directory, 'Nhạc chuông #1%.mp3');
  const ringback = path.join(directory, 'Chờ.wav');
  fs.writeFileSync(ringtone, 'test');
  fs.writeFileSync(ringback, 'test');
  const store = createStore(directory);
  assert.deepEqual(store.read(), { ringtone: '', ringback: '' });
  store.save('ringtone', ringtone);
  store.save('ringback', ringback);
  const restarted = createStore(directory);
  assert.deepEqual(restarted.read(), { ringtone, ringback });
  assert.deepEqual(restarted.soundUrls(), {
    ringtone: pathToFileURL(ringtone).href, ringback: pathToFileURL(ringback).href
  });
  restarted.save('ringtone', '');
  assert.deepEqual(store.read(), { ringtone: '', ringback });
  fs.unlinkSync(ringback);
  assert.deepEqual(store.soundUrls(), {});
});

test('invalid sound changes cannot overwrite saved settings', (t) => {
  const directory = temporaryDirectory(t);
  const sound = path.join(directory, 'sound.ogg');
  fs.writeFileSync(sound, 'test');
  const store = createStore(directory);
  store.save('ringtone', sound);
  for (const [kind, value] of [
    ['end', sound], ['ringtone', null], ['ringtone', 'relative.mp3'],
    ['ringtone', path.join(directory, 'missing.mp3')],
    ['ringtone', path.join(directory, 'settings.json')], ['ringtone', directory]
  ]) assert.throws(() => store.save(kind, value));
  assert.deepEqual(store.read(), { ringtone: sound, ringback: '' });
});

test('settings reuse one window, restrict IPC, and keep userscript operations in that window', async (t) => {
  const directory = temporaryDirectory(t);
  const app = new EventEmitter();
  app.getPath = () => directory;
  const handlers = {};
  const ipcMain = { handle: (name, handler) => { handlers[name] = handler; } };
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      windows.push(this);
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = () => {};
    }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    setMenuBarVisibility() {}
    removeMenu() {}
    loadFile(file) { this.file = file; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
  }
  let dialogParent;
  const scriptFile = path.join(directory, 'example.user.js');
  fs.writeFileSync(scriptFile, '// ==UserScript==\n// @name Imported\n// ==/UserScript==\nvoid 0;');
  const dialog = { showOpenDialog: async (parent) => {
    dialogParent = parent;
    return { canceled: false, filePaths: [scriptFile] };
  } };
  const advancedSettings = require('../plugins/advanced-settings').register({ app, ipcMain, BrowserWindow, dialog });
  const filename = path.join(__dirname, '../plugins/userscripts/index.js');
  const sandbox = {
    module: { exports: {} }, __dirname: path.dirname(filename), console, Buffer,
    require: (name) => name === 'electron' ? { dialog } : require(name)
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  sandbox.module.exports.register({ app, ipcMain, advancedSettings });
  const main = new EventEmitter();
  main.isDestroyed = () => false;
  main.webContents = new EventEmitter();
  main.webContents.getURL = () => 'file:///app/pc-dist/index.html';
  app.emit('browser-window-created', {}, main);
  const event = { preventDefault() {} };
  main.emit('page-title-updated', event, 'LINUX_ADVANCED_SETTINGS_TRIGGER');
  main.emit('page-title-updated', event, 'LINUX_ADVANCED_SETTINGS_TRIGGER');
  assert.equal(windows.length, 1);
  const win = advancedSettings.getWindow();
  assert.equal(win.focused, true);
  assert.equal(path.basename(win.file), 'index.html');
  const sender = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  for (const name of ['linux-settings:get', 'userscripts:list']) {
    assert.throws(() => handlers[name]({ sender: main.webContents }), /rejected/);
    assert.throws(() => handlers[name]({ ...sender, senderFrame: {} }), /rejected/);
  }
  const imported = await handlers['userscripts:import-file'](sender);
  assert.equal(dialogParent, win);
  assert.equal(imported.suggestedName, 'Imported');
  const saved = handlers['userscripts:save'](sender, { code: imported.code });
  assert.equal(handlers['userscripts:list'](sender).length, 1);
  assert.equal(handlers['userscripts:toggle'](sender, saved.id, false).enabled, false);
  handlers['userscripts:remove'](sender, saved.id);
  assert.equal(handlers['userscripts:list'](sender).length, 0);
});

test('call sound IPC reads newly saved preferences and only accepts local call pages', (t) => {
  const directory = temporaryDirectory(t);
  const sound = path.join(directory, 'sound.wav');
  fs.writeFileSync(sound, 'test');
  const filename = path.join(__dirname, '../plugins/zcall/window.js');
  const localRequire = createRequire(filename);
  const handlers = {};
  const server = { on() {}, listen() {}, close() {} };
  const sandbox = {
    module: { exports: {} }, __dirname: path.dirname(filename), Buffer, console,
    process: { env: {}, execPath: process.execPath },
    require: (name) => {
      if (name === 'net') return { createServer: () => server };
      if (name === 'electron') return {
        app: { getPath: () => directory },
        ipcMain: { handle: (name, handler) => { handlers[name] = handler; }, on() {} }
      };
      return localRequire(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  sandbox.module.exports.start();
  const handler = handlers['zcall-ui-sounds'];
  const eventFor = (url) => {
    const frame = { url };
    return { sender: { mainFrame: frame }, senderFrame: frame };
  };
  const call = eventFor(pathToFileURL(path.join(path.dirname(filename), 'ui/call.html')).href + '?assets=/assets');
  const incoming = eventFor(pathToFileURL(path.join(path.dirname(filename), 'ui/incoming.html')).href);
  assert.deepEqual(handler(call), {});
  const store = createStore(directory);
  store.save('ringtone', sound);
  store.save('ringback', sound);
  assert.deepEqual(handler(incoming), { ringtone: pathToFileURL(sound).href, ringback: pathToFileURL(sound).href });
  store.save('ringback', '');
  assert.deepEqual(handler(call), { ringtone: pathToFileURL(sound).href });
  assert.throws(() => handler(eventFor('https://chat.zalo.me/')), /rejected/);
  assert.throws(() => handler({ ...incoming, senderFrame: { url: incoming.senderFrame.url } }), /rejected/);
});

function renderer() {
  const audio = [];
  const requests = [];
  class Audio {
    constructor(url) { this.url = url; this.events = {}; audio.push(this); }
    addEventListener(name, handler) { this.events[name] = handler; }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const sandbox = {
    location: { search: '?assets=/default-assets' }, URLSearchParams, Audio,
    document: { querySelectorAll: () => [], fonts: { add() {} } },
    FontFace: class { load() { return Promise.resolve(this); } }, window: {},
    require: () => ({ ipcRenderer: { invoke: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugins/zcall/ui/assets.js'), 'utf8'), sandbox);
  return { ...sandbox.window.zcallAssets, audio, requests };
}

test('incoming and outgoing sounds use saved overrides, avoid duplicate playback and stop', async () => {
  const r = renderer();
  for (const kind of ['ringtone', 'ringback']) {
    r.playSound(kind, true);
    r.playSound(kind, true);
    const request = r.requests.shift();
    assert.equal(r.requests.length, 0);
    request.resolve({ [kind]: `file:///custom-${kind}.mp3` });
    await Promise.resolve();
    const sound = r.audio.at(-1);
    assert.equal(sound.url, `file:///custom-${kind}.mp3`);
    assert.equal(sound.loop, true);
    r.stopSound(kind);
    assert.equal(sound.paused, true);
  }
});

test('stopping while sound settings are pending prevents late ringing, including across calls', async () => {
  const r = renderer();
  r.playSound('ringtone', true);
  r.stopSound('ringtone');
  r.playSound('ringtone', true);
  r.requests[0].resolve({ ringtone: 'file:///old.mp3' });
  await Promise.resolve();
  assert.equal(r.audio.length, 0);
  r.requests[1].resolve({ ringtone: 'file:///new.mp3' });
  await Promise.resolve();
  assert.equal(r.audio.length, 1);
  assert.equal(r.audio[0].url, 'file:///new.mp3');
});

test('unplayable custom sounds and unavailable settings fall back; end sound stays unchanged', async () => {
  const r = renderer();
  r.playSound('ringback', true);
  r.requests[0].resolve({ ringback: 'file:///broken.mp3' });
  await Promise.resolve();
  r.audio[0].events.error();
  assert.equal(r.audio[0].paused, true);
  assert.equal(r.audio[1].url, 'file:///default-assets/sound/zalo_ringback.mp3');
  // A late error from the custom file cannot start another default sound.
  r.audio[0].events.error();
  assert.equal(r.audio.length, 2);
  r.playSound('ringtone', true);
  r.requests[1].reject(new Error('IPC unavailable'));
  await Promise.resolve();
  assert.equal(r.audio[2].url, 'file:///default-assets/sound/zalo_ringtone.mp3');
  r.playSound('end', false);
  assert.equal(r.audio[3].url, 'file:///default-assets/sound/endcall.mp3');
  assert.equal(r.audio[3].loop, false);
});
