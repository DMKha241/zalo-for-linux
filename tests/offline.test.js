'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createStore, sessionKey } = require('../plugins/offline/store');
const { createOfflineController } = require('../plugins/offline/renderer');
const { register } = require('../plugins/offline');
const { patchAuthBundle, main: patchApp } = require('../scripts/patches/patch-offline-startup');

const info = () => ({
  config: { uid: 'alice', settings: { features: {} }, current_time: 1000 },
  UIN: 'local-database-key', decryptKey: 'message-key', requestStartTime: 900000
});
const record = () => ({ version: 1, clientId: 'device', info: info() });
const cookie = value => ({ domain: '.zaloapp.com', name: 'zpw_sek', value, secure: true, httpOnly: true });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness({ cached = record(), online = false, reload = () => true } = {}) {
  const timers = new Map();
  let time = 2000000, id = 0, onOnline, onUnload;
  const calls = { reload: 0, clear: 0, disconnected: 0, writes: [], status: [] };
  const storage = {
    async read() { return cached; },
    async write(value) { calls.writes.push(value); cached = value; },
    async clear() { calls.clear++; cached = null; }
  };
  const controller = createOfflineController({
    storage, now: () => time, isOnline: () => online,
    setTimeout(fn, delay) { timers.set(++id, { fn, at: time + delay }); return id; },
    clearTimeout(key) { timers.delete(key); },
    onOnline(fn) { onOnline = fn; }, onUnload(fn) { onUnload = fn; },
    reload() { calls.reload++; return reload(); }, showStatus(value) { calls.status.push(value); }
  });
  return {
    controller, calls, storage, timers,
    options: { clientId: 'device', userId: 'alice', onOffline() { calls.disconnected++; } },
    connect() { online = true; onOnline(); }, unload() { onUnload(); },
    async tick(ms) {
      const end = time + ms;
      for (;;) {
        await flush();
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].fn();
      }
      time = end; await flush();
    }
  };
}

test('session cache survives restart, is encrypted, and cannot be read with a new/removed cookie', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-offline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = sessionKey([cookie('session-a')]);
  const store = createStore(dir);
  assert.equal(store.write(key, record()), true);
  assert.deepEqual(createStore(dir).read(key), record());
  const file = path.join(dir, 'linux-offline-session.enc');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file).includes(Buffer.from('local-database-key')), false);
  assert.equal(store.read(sessionKey([cookie('session-b')])), null);
  assert.equal(store.read(sessionKey([])), null);
  assert.equal(store.write(key, {}), false);
  const corrupt = fs.readFileSync(file); corrupt[corrupt.length - 1] ^= 1; fs.writeFileSync(file, corrupt);
  assert.equal(store.read(key), null);
  store.clear(); assert.equal(store.read(key), null);
});

test('offline startup supplies the last account to native DB initialization and preserves clock offset', async () => {
  const h = harness();
  let requests = 0;
  const saved = await h.controller.fetchLoginInfo(() => { requests++; return info(); }, h.options);
  assert.equal(requests, 0);
  assert.equal(saved.config.uid, 'alice');
  assert.equal(saved.UIN, 'local-database-key');
  assert.equal(saved.config.current_time * 1000 - saved.requestStartTime, 100000);
  assert.equal(h.calls.disconnected, 1);
  assert.equal(h.controller.active, true);
});

test('online startup uses fresh info and updates the cache', async () => {
  const h = harness({ online: true });
  const fresh = info(); fresh.config.current_time = 3000;
  assert.equal(await h.controller.fetchLoginInfo(async () => fresh, h.options), fresh);
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.controller.active, false);
  assert.equal(h.timers.size, 0);
});

test('first login, different device, and different account cannot restore old data', async () => {
  for (const changes of [{ cached: null }, { userId: 'bob' }, { clientId: 'other' }, { userId: null }]) {
    const h = harness(Object.hasOwn(changes, 'cached') ? changes : {});
    Object.assign(h.options, changes);
    await assert.rejects(h.controller.fetchLoginInfo(async () => { throw { code: 'ERR_NO_NETWORK' }; }, h.options));
    assert.equal(h.controller.active, false);
  }
});

test('network error with navigator online still opens local history', async () => {
  const h = harness({ online: true });
  const result = await h.controller.fetchLoginInfo(async () => { throw { code: 'ERR_NAME_NOT_RESOLVED' }; }, h.options);
  assert.equal(result.config.uid, 'alice');
  assert.equal(h.controller.active, true);
});

test('slow network falls back after 8 seconds and a late success reloads only after UI initialization', async () => {
  const h = harness({ online: true });
  const pending = deferred();
  const startup = h.controller.fetchLoginInfo(() => pending.promise, h.options);
  await h.tick(8000);
  assert.equal((await startup).config.uid, 'alice');
  pending.resolve(info()); await flush();
  assert.equal(h.calls.reload, 0);
  h.controller.markReady(); h.controller.markReady(); h.connect();
  await flush();
  assert.equal(h.calls.reload, 1);
});

test('failed recovery navigation retries instead of leaving an updating badge forever', async () => {
  for (const failure of [() => false, () => Promise.reject(new Error('navigation blocked'))]) {
    let attempts = 0;
    const h = harness({ reload: () => ++attempts === 1 ? failure() : true });
    await h.controller.fetchLoginInfo(async () => info(), h.options);
    h.controller.markReady();
    h.connect(); await flush();
    assert.equal(h.calls.reload, 1);
    assert.match(h.calls.status.at(-1), /Zalo sẽ thử lại/);
    await h.tick(10000);
    assert.equal(h.calls.reload, 2);
  }
});

test('reconnect is single-flight, waits for Zalo success, and automatically reloads once', async () => {
  const h = harness();
  const pending = deferred(); let requests = 0;
  await h.controller.fetchLoginInfo(() => { requests++; return pending.promise; }, h.options);
  h.controller.markReady();
  h.connect(); h.connect(); h.connect(); await flush();
  assert.equal(requests, 1);
  assert.equal(h.calls.reload, 0);
  pending.resolve(info()); await flush();
  assert.equal(h.calls.reload, 1);
  assert.equal(h.calls.writes.length, 1);
});

test('periodic retry works even if navigator stays offline after resume', async () => {
  const h = harness(); let requests = 0;
  await h.controller.fetchLoginInfo(async () => {
    if (++requests === 1) throw { code: 'ERR_NO_NETWORK' };
    return info();
  }, h.options);
  h.controller.markReady();
  await h.tick(10000); assert.equal(h.calls.reload, 0);
  await h.tick(10000); assert.equal(h.calls.reload, 1);
});

test('an indefinitely queued request times out so reconnect can retry', async () => {
  const h = harness(); let requests = 0;
  await h.controller.fetchLoginInfo(() => ++requests === 1 ? new Promise(() => {}) : Promise.resolve(info()), h.options);
  h.controller.markReady();
  await h.tick(10000); assert.equal(requests, 1);
  await h.tick(15000); assert.equal(requests, 1);
  await h.tick(10000); assert.equal(requests, 2); assert.equal(h.calls.reload, 1);
});

test('rejected session is never treated as a network failure, even with a network code', async () => {
  const h = harness({ online: true });
  const error = { code: 'ERR_NO_NETWORK', data: { error_code: 102 } };
  await assert.rejects(h.controller.fetchLoginInfo(async () => { throw error; }, h.options));
  assert.equal(h.controller.active, false);
  assert.equal(h.calls.clear, 1);
});

test('session revoked while offline clears cache and returns to normal login', async () => {
  const h = harness();
  await h.controller.fetchLoginInfo(async () => { throw { data: { error_code: 102 } }; }, h.options);
  h.connect(); await flush();
  assert.equal(h.calls.clear, 1);
  assert.equal(h.calls.reload, 1);
});

test('temporary server errors keep the cache and allow the next authentication attempt', async () => {
  const h = harness({ online: true });
  await assert.rejects(h.controller.fetchLoginInfo(async () => { throw { status: 503 }; }, h.options));
  assert.equal(h.calls.clear, 0);
  assert.equal(h.controller.active, false);
  assert.deepEqual(await h.controller.fetchLoginInfo(async () => info(), h.options), info());
});

test('logout/unload cancels reconnect and ignores late requests', async () => {
  for (const action of ['logout', 'unload']) {
    const h = harness(); const pending = deferred();
    await h.controller.fetchLoginInfo(() => pending.promise, h.options);
    h.connect(); await flush();
    if (action === 'logout') await h.controller.invalidate(); else h.unload();
    pending.resolve(info()); await flush(); await h.tick(60000);
    assert.equal(h.calls.writes.length, 0);
    assert.equal(h.calls.reload, 0);
  }
});

test('cache read failure preserves normal online login', async () => {
  const h = harness({ online: true });
  h.storage.read = async () => { throw new Error('corrupt file'); };
  h.storage.write = async () => { throw new Error('disk full'); };
  assert.deepEqual(await h.controller.fetchLoginInfo(async () => info(), h.options), info());
});

test('IPC rejects other windows/subframes and logout wins over an in-flight cache write', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-offline-ipc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {};
  register({ app: { getPath: () => dir }, appDir: '/test/app', ipcMain: { handle(name, fn) { handlers[name] = fn; } } });
  const cookies = deferred();
  const frame = { url: 'file:///test/app/pc-dist/index.html' };
  const event = { senderFrame: frame, sender: { mainFrame: frame, session: { cookies: { get: () => cookies.promise } } } };
  const pendingWrite = handlers['linux-offline:write'](event, record());
  handlers['linux-offline:clear'](event);
  cookies.resolve([cookie('session')]);
  assert.equal(await pendingWrite, false);
  assert.equal(await handlers['linux-offline:read'](event), null);
  await assert.rejects(handlers['linux-offline:read']({ ...event, senderFrame: { ...frame } }));
  frame.url = 'https://zalo.me/index.html';
  await assert.rejects(handlers['linux-offline:read'](event));
});

test('patch rejects unknown upstream code instead of silently shipping no offline support', () => {
  assert.throws(() => patchAuthBundle('unknown upstream version'), /upstream bundle changed/);
});

test('recovery reload overrides cancelled unload, ignores subframe errors and cleans up listeners', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-offline-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {};
  register({ app: { getPath: () => dir }, appDir: '/test/app', ipcMain: { handle(name, fn) { handlers[name] = fn; } } });
  const sender = new EventEmitter();
  sender.mainFrame = { url: 'file:///test/app/pc-dist/index.html' };
  const event = { sender, senderFrame: sender.mainFrame };
  let allowed = false;
  sender.reloadIgnoringCache = () => {
    sender.emit('will-prevent-unload', { preventDefault() { allowed = true; } });
    sender.emit('did-fail-load', {}, -105, 'subframe offline', 'https://example.test', false);
    sender.emit('did-start-navigation', {}, sender.mainFrame.url, false, true);
    sender.emit('did-finish-load');
  };
  assert.equal(await handlers['linux-offline:refresh'](event), true);
  assert.equal(allowed, true);
  assert.deepEqual(sender.eventNames(), []);
  sender.reloadIgnoringCache = () => { throw new Error('window destroyed'); };
  await assert.rejects(handlers['linux-offline:refresh'](event), /window destroyed/);
  assert.deepEqual(sender.eventNames(), []);
});

const extracted = path.join(__dirname, '..', 'app');
test('patch applies idempotently to the extracted app and generated bundles parse', {
  skip: !fs.existsSync(path.join(extracted, 'pc-dist', 'lazy'))
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-offline-patch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'pc-dist', 'lazy'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'main-dist'));
  const bundle = fs.readdirSync(path.join(extracted, 'pc-dist', 'lazy')).find(n => /^default-login-main-startup-shared-worker-znotification\./.test(n));
  for (const relative of [`pc-dist/lazy/${bundle}`, 'pc-dist/index.html', 'pc-dist/login.html', 'main-dist/preload-render.js']) {
    fs.copyFileSync(path.join(extracted, relative), path.join(dir, relative));
  }
  await patchApp(dir);
  const result = fs.readFileSync(path.join(dir, 'pc-dist/lazy', bundle), 'utf8');
  await patchApp(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'pc-dist/lazy', bundle), 'utf8'), result);
  new vm.Script(result);
  new vm.Script(fs.readFileSync(path.join(dir, 'main-dist', 'preload-render.js'), 'utf8'));
  new vm.Script(fs.readFileSync(path.join(dir, 'pc-dist', 'linux-offline.js'), 'utf8'));
  assert.equal((fs.readFileSync(path.join(dir, 'pc-dist', 'index.html'), 'utf8').match(/src="linux-offline.js"/g) || []).length, 1);

  // Execute the actual patched preload methods with a tiny local database.
  // Fail if startup tries to fetch a group/friend list before dispatching it.
  const method = (start, end) => {
    const offset = result.indexOf(start);
    assert.ok(offset >= 0, start);
    const limit = result.indexOf(end, offset);
    assert.ok(limit > offset, end);
    return result.slice(offset, limit);
  };
  // Offline message reads must not wait behind cloud verification, even when
  // server config enables cloud history for the conversation.
  const cloudContext = {
    __zaloOffline: { active: true },
    a: { default: { cloud: { enable: true, load_last_msg_enable: true } } },
    s: { d: { OVER_QUEUE: 1 } }, i: { GROUPID_PREFIX: 'group-' }
  };
  const cloud = vm.runInNewContext(`({${method('apiEnable(e,t){', 'getPreventCloudLoadPollingDuration(')}})`, cloudContext);
  assert.equal(cloud.apiEnable(1, 'group-1'), false);
  cloudContext.__zaloOffline.active = false;
  assert.equal(cloud.apiEnable(1, 'group-1'), true);
  for (const kind of ['friends', 'groups']) {
    const reads = [], dispatches = [];
    const context = {
      __zaloOffline: { active: true },
      Promise,
      i: { a: { async init() { reads.push('groups'); }, getGroupIds: () => ['group-1'] },
        b: { setCallbackToFriendWorker() {} } },
      r: { a: { async init() { reads.push('friends'); }, getFriendIds: () => ['friend-1'] } },
      k: { async init() {} }, I: { async init() {} },
      E: { default: { group_config: { enable_flow_v2: true } } },
      F: { FriendsAction: { INIT_DATA_FRIENDS: 'friends' } },
      v: { GroupsAction: { INIT_DATA_GROUPS: 'groups' } },
      g: { default: { callUpdate() {} } },
      H: { b: { addEventListener() {}, Group: {} } }, N: { n: { listenEvent() {} } }
    };
    const source = kind === 'friends'
      ? method('_isNeedFetchFriendList(){', '_isNeedFetchToGetOAInfo(') + ',' +
        method('async init(){this._inited||', 'subscribeEventFriend(')
      : method('_isNeedFetchGroupList(){', '_genObjectGetInfoGroup(') + ',' +
        method('async init(){this._timeTracker.start()', '_deleteGroupConversation(');
    const manager = vm.runInNewContext(`({${source}})`, context);
    manager._timeTracker = { start() {}, track() {}, end() {} };
    manager._signalUpdate = (type, ids) => dispatches.push([type, [...ids]]);
    manager.doFetchGroupList = () => assert.fail('Network fetch during offline preload');
    await manager.init();
    assert.deepEqual(reads, [kind]);
    assert.deepEqual(dispatches, [[kind, [kind === 'friends' ? 'friend-1' : 'group-1']]]);
  }
});
