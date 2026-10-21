'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function validRecord(record) {
  const info = record && record.info;
  return !!(record && record.version === 1 && typeof record.clientId === 'string' &&
    record.clientId && info && info.config && info.config.uid &&
    info.config.settings && info.config.settings.features && info.UIN && info.decryptKey);
}

// The existing HttpOnly session cookies are the key material. No extra copy of
// the session or a plaintext decryption key is persisted alongside this file.
function sessionKey(cookies) {
  const values = cookies.filter(c => c.name === 'zpw_sek' && c.value && c.httpOnly && c.secure)
    .map(c => `${c.domain}:${c.value}`).sort();
  return values.length ? crypto.createHash('sha256').update(JSON.stringify(values)).digest() : null;
}

function createStore(directory) {
  const file = path.join(directory, 'linux-offline-session.enc');
  return {
    read(key) {
      if (!key) return null;
      try {
        const data = fs.readFileSync(file);
        if (data.length < 29) return null;
        const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
        cipher.setAuthTag(data.subarray(12, 28));
        const record = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
        return validRecord(record) ? record : null;
      } catch (_) { return null; }
    },
    write(key, record) {
      if (!key || !validRecord(record)) return false;
      const plain = JSON.stringify(record);
      if (Buffer.byteLength(plain) > 4 * 1024 * 1024) return false;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      return true;
    },
    clear() {
      fs.rmSync(file, { force: true });
    }
  };
}

module.exports = { createStore, sessionKey, validRecord };
