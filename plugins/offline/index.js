'use strict';

const path = require('path');
const { fileURLToPath } = require('url');
const { createStore, sessionKey } = require('./store');

function register({ app, ipcMain, appDir }) {
  const store = createStore(app.getPath('userData'));
  const pages = ['index.html', 'login.html'].map(name => path.join(appDir, 'pc-dist', name));
  let generation = 0;
  function assertSender(event) {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) throw new Error('Invalid offline session sender');
    const url = new URL(frame.url);
    if (url.protocol !== 'file:' || !pages.includes(fileURLToPath(url))) {
      throw new Error('Invalid offline session page');
    }
  }
  ipcMain.handle('linux-offline:read', async event => {
    assertSender(event);
    const current = generation;
    const key = sessionKey(await event.sender.session.cookies.get({ name: 'zpw_sek' }));
    return current === generation ? store.read(key) : null;
  });
  ipcMain.handle('linux-offline:write', async (event, record) => {
    assertSender(event);
    const current = generation;
    const key = sessionKey(await event.sender.session.cookies.get({ name: 'zpw_sek' }));
    return current === generation && store.write(key, record);
  });
  ipcMain.handle('linux-offline:clear', event => {
    assertSender(event);
    generation++;
    store.clear();
  });
  ipcMain.handle('linux-offline:refresh', async event => {
    assertSender(event);
    const contents = event.sender;
    // Zalo can cancel a normal window.location.reload() while its DB and
    // renderer are active. Limit the unload override to this recovery reload.
    let started = false;
    const allowUnload = e => e.preventDefault();
    contents.on('will-prevent-unload', allowUnload);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('Reload timed out')); }, 20000);
        function cleanup() {
          clearTimeout(timer);
          contents.removeListener('did-finish-load', done);
          contents.removeListener('did-fail-load', failed);
          contents.removeListener('did-start-navigation', navigation);
        }
        function done() { cleanup(); resolve(); }
        function failed(_event, code, message, _url, isMainFrame) {
          if (!isMainFrame) return;
          cleanup(); reject(new Error(message || `Reload failed: ${code}`));
        }
        function navigation(_event, _url, _isInPlace, isMainFrame) { if (isMainFrame) started = true; }
        contents.once('did-finish-load', done);
        contents.on('did-fail-load', failed);
        contents.on('did-start-navigation', navigation);
        try { contents.reloadIgnoringCache(); } catch (error) { cleanup(); reject(error); }
      });
      return started;
    } finally {
      contents.removeListener('will-prevent-unload', allowUnload);
    }
  });
}

module.exports = { register };
