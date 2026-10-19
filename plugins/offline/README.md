# Offline startup

`patch-offline-startup.js` wraps the extracted app's `fetchLoginInfo` boundary.
Successful responses are cached; offline startup reuses the same UID and UIN so
Zalo's own bootstrap opens the existing per-user SQLite/IndexedDB databases and
loads the profile, contacts, groups and conversations. No second message store
or HTML snapshot is created. Session renewal and optional server refreshes are
skipped during offline startup. The network patch exposes the real network state.

The cache is AES-256-GCM encrypted using a key derived from the existing secure,
HttpOnly `zpw_sek` cookies. It is written atomically with mode 0600 in userData.
Missing/changed cookies, corrupt data, another client ID or another UID prevent
restoration. IPC accepts only the main frame of the local login/index pages.
Logout, account replacement and rejected sessions invalidate the cache; pending
writes cannot recreate it after invalidation.

Cached startup waits at most eight seconds for an online login request. Offline
startup retries every ten seconds and on the browser's online event, with only
one active attempt and a fifteen-second timeout. It probes even if Chromium's
`navigator.onLine` remains false after suspend. An accepted login response is
cached and the page reloads once after local UI initialization, allowing Zalo's
normal bootstrap to apply the fresh config and synchronize messages.

The build applies the patch after `patch-network-and-sync-fix.js`. For an already
extracted development app, run both scripts and restart `npm start`. Open online
once to seed the cache. The patch checks its upstream anchors and fails the build
if they change instead of silently leaving startup broken.

Validation:

```sh
node tests/offline.test.js
```

The tests cover cache persistence/encryption, account isolation, startup timeout,
reconnect, rejection, logout races, IPC validation and generated-bundle syntax.
With an extracted app present, they also check patch idempotency.

Manual acceptance with a real account (not covered by the mocked tests):

1. Open online with remembered login, open several chats, then quit normally.
2. Disconnect internet and restart. Verify the account, contact/group names and
   previously downloaded messages. Open another cached chat and check app lock.
3. Reconnect. Verify a single automatic reload, incoming messages and updated UI.
4. Repeat with Wi-Fi connected but its internet uplink unavailable, and after
   suspend/resume. Verify a slow login cannot leave the loading screen stuck.
5. Log out, quit, then start offline: the old session must not be restored.
   Repeat after switching accounts and with a server-revoked session.

Only the existing local history is available offline. First login and content
that was never downloaded still require internet. Cookie expiry also requires
online authentication; this plugin does not extend or recreate session cookies.
