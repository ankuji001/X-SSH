// X-SSH — main process: SSH connection, shells, SFTP, port forwarding, profiles.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { Client, utils: sshUtils } = require('ssh2');

const DATA_DIR = app.getPath('userData');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const KNOWN_HOSTS_FILE = path.join(DATA_DIR, 'known_hosts.json');

// ---------- persistence helpers ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
const enc = (s) => (s && canEncrypt() ? safeStorage.encryptString(s).toString('base64') : '');
const dec = (s) => { try { return s ? safeStorage.decryptString(Buffer.from(s, 'base64')) : ''; } catch { return ''; } };

// ---------- per-window session state ----------
// Each BrowserWindow owns at most one SSH connection, like Bitvise's one-client-per-connection model.
const sessions = new Map(); // webContents.id -> Session

class Session {
  constructor(wc) {
    this.wc = wc;
    this.conn = null;
    this.sftp = null;
    this.shells = new Map();
    this.forwards = new Map();
    this.nextId = 1;
    this.pending = new Map(); // prompt id -> resolver
    this.cancelled = new Set();
    this.watchers = new Map();
  }
  send(ch, payload) { if (!this.wc.isDestroyed()) this.wc.send(ch, payload); }
  log(msg, level = 'info') { this.send('log', { t: Date.now(), level, msg }); }
  ask(kind, data) {
    const id = this.nextId++;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.send('prompt', { id, kind, ...data }); });
  }
  async getSftp() {
    if (this.sftp) return this.sftp;
    if (!this.conn) throw new Error('Not connected');
    this.sftp = await new Promise((res, rej) => this.conn.sftp((e, s) => (e ? rej(e) : res(s))));
    this.sftp.on('close', () => { this.sftp = null; });
    return this.sftp;
  }
  teardown() {
    for (const f of this.forwards.values()) try { f.server?.close(); } catch {}
    this.forwards.clear();
    for (const w of this.watchers.values()) try { w.close(); } catch {}
    this.watchers.clear();
    this.shells.clear();
    this.sftp = null;
    if (this.conn) { try { this.conn.end(); } catch {} this.conn = null; }
  }
}
const childOf = new Map(); // child webContents.id -> Session (terminal / SFTP windows share the parent's connection)
function S(e) {
  const id = e.sender.id;
  if (childOf.has(id)) return childOf.get(id);
  if (!sessions.has(id)) {
    const s = new Session(e.sender);
    s.children = new Set();
    sessions.set(id, s);
    e.sender.once('destroyed', () => {
      s.teardown(); sessions.delete(id);
      for (const w of s.children) if (!w.isDestroyed()) w.close();
    });
  }
  return sessions.get(id);
}
// Send to the session window and every child window.
function broadcast(s, ch, payload) {
  s.send(ch, payload);
  for (const w of s.children) if (!w.isDestroyed()) w.webContents.send(ch, payload);
}

// ---------- windows ----------
const WEB_PREFS = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };
function createWindow(profileName) {
  const win = new BrowserWindow({
    width: 980, height: 760, minWidth: 760, minHeight: 560,
    title: 'X-SSH', backgroundColor: '#1e1e2e', autoHideMenuBar: true,
    icon: path.join(__dirname, 'renderer', 'icon.png'), webPreferences: WEB_PREFS,
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: profileName ? { profile: profileName } : {} });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(() => createWindow());
app.on('window-all-closed', () => app.quit());
ipcMain.handle('win:new', (_e, profileName) => createWindow(profileName));

// Terminal / SFTP windows: independent top-level windows bound to the caller's SSH session.
ipcMain.handle('win:child', (e, { kind, cfg, extra }) => {
  const s = S(e);
  if (!s.conn) throw new Error('Not connected');
  const parent = BrowserWindow.fromWebContents(e.sender);
  const [px, py] = parent.getPosition();
  const off = 30 * (s.children.size % 8 + 1);
  const win = new BrowserWindow({
    width: kind === 'sftp' ? 1180 : 900, height: kind === 'sftp' ? 720 : 560, x: px + off, y: py + off,
    title: kind === 'sftp' ? `SFTP — ${cfg.username}@${cfg.host}` : `${cfg.username}@${cfg.host}`,
    backgroundColor: '#11111b', autoHideMenuBar: true, icon: path.join(__dirname, 'renderer', 'icon.png'), webPreferences: WEB_PREFS,
  });
  const wcId = win.webContents.id;
  childOf.set(wcId, s); s.children.add(win);
  win.tbInit = { kind, cfg, extra: extra || {} };
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => {
    s.children.delete(win); childOf.delete(wcId);
    for (const [id, sh] of s.shells) if (sh.wcId === wcId) { try { sh.stream.end(); } catch {} s.shells.delete(id); }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { mode: kind } });
  return true;
});
ipcMain.handle('win:childInit', (e) => BrowserWindow.fromWebContents(e.sender)?.tbInit || null);
ipcMain.handle('win:tile', (e) => {
  const s = S(e);
  const wins = [...s.children].filter((w) => !w.isDestroyed() && !w.isMinimized());
  if (!wins.length) return 0;
  const { screen } = require('electron');
  const area = screen.getDisplayMatching(BrowserWindow.fromWebContents(e.sender).getBounds()).workArea;
  const cols = Math.ceil(Math.sqrt(wins.length)); const rows = Math.ceil(wins.length / cols);
  const w = Math.floor(area.width / cols); const h = Math.floor(area.height / rows);
  wins.forEach((win, i) => {
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({ x: area.x + (i % cols) * w, y: area.y + Math.floor(i / cols) * h, width: w, height: h });
  });
  return wins.length;
});
ipcMain.on('win:focusSession', (e) => { const s = S(e); const w = BrowserWindow.fromWebContents(s.wc); if (w) { w.show(); w.focus(); } });
ipcMain.on('prompt:reply', (e, { id, value }) => {
  const s = S(e); const r = s.pending.get(id);
  if (r) { s.pending.delete(id); r(value); }
});

// ---------- profiles ----------
ipcMain.handle('profiles:list', () => {
  const all = readJSON(PROFILES_FILE, {});
  return Object.values(all).map((p) => ({ ...p, password: p.password ? dec(p.password) : '', passphrase: p.passphrase ? dec(p.passphrase) : '' }));
});
ipcMain.handle('profiles:save', (_e, p) => {
  const all = readJSON(PROFILES_FILE, {});
  const copy = { ...p };
  copy.password = p.savePassword ? enc(p.password) : '';
  copy.passphrase = p.savePassword ? enc(p.passphrase) : '';
  all[p.name] = copy;
  writeJSON(PROFILES_FILE, all);
  return { encrypted: canEncrypt() };
});
ipcMain.handle('profiles:delete', (_e, name) => {
  const all = readJSON(PROFILES_FILE, {}); delete all[name]; writeJSON(PROFILES_FILE, all);
});
ipcMain.handle('profiles:export', async (e) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: 'x-ssh-profiles.json' });
  if (r.canceled) return false;
  const all = readJSON(PROFILES_FILE, {});
  for (const p of Object.values(all)) { p.password = ''; p.passphrase = ''; }
  writeJSON(r.filePath, all); return true;
});
ipcMain.handle('profiles:import', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return 0;
  const incoming = readJSON(r.filePaths[0], {});
  const all = readJSON(PROFILES_FILE, {});
  let n = 0;
  for (const [k, v] of Object.entries(incoming)) if (v && v.host) { all[k] = { ...v, name: k, password: '', passphrase: '' }; n++; }
  writeJSON(PROFILES_FILE, all); return n;
});
ipcMain.handle('dialog:keyfile', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('hostkeys:list', () => readJSON(KNOWN_HOSTS_FILE, {}));
ipcMain.handle('hostkeys:delete', (_e, key) => { const k = readJSON(KNOWN_HOSTS_FILE, {}); delete k[key]; writeJSON(KNOWN_HOSTS_FILE, k); });

// ---------- connect ----------
function defaultKeys() {
  return ['id_ed25519', 'id_ecdsa', 'id_rsa'].map((n) => path.join(os.homedir(), '.ssh', n)).filter((f) => fs.existsSync(f));
}

async function loadKey(s, file, passphrase) {
  const raw = await fsp.readFile(file);
  let parsed = sshUtils.parseKey(raw, passphrase || undefined);
  let tries = 0;
  while (parsed instanceof Error && /encrypted|passphrase|decrypt/i.test(parsed.message) && tries < 3) {
    const pp = await s.ask('secret', { title: 'Key passphrase', label: `Passphrase for ${path.basename(file)}` });
    if (pp == null) return null;
    passphrase = pp; parsed = sshUtils.parseKey(raw, pp); tries++;
  }
  if (parsed instanceof Error) { s.log(`Key ${file}: ${parsed.message}`, 'warn'); return null; }
  return { key: raw, passphrase };
}

ipcMain.handle('ssh:connect', async (e, p) => {
  const s = S(e);
  if (s.conn) s.teardown();
  const host = p.host.trim(); const port = Number(p.port) || 22; const username = p.username.trim();
  const hostId = `${host}:${port}`;
  s.log(`Connecting to ${username}@${hostId} ...`);

  // Build the ordered list of auth attempts.
  const methods = [];
  const kbd = (password) => ({
    type: 'keyboard-interactive', username,
    prompt: async (name, instructions, _lang, prompts, finish) => {
      if (password && prompts.length === 1 && /password/i.test(prompts[0].prompt)) { const pw = password; password = null; return finish([pw]); }
      const answers = [];
      for (const pr of prompts) {
        const v = await s.ask(pr.echo ? 'text' : 'secret', { title: name || 'Keyboard-interactive', label: (instructions ? instructions + '\n' : '') + pr.prompt });
        if (v == null) return finish([]);
        answers.push(v);
      }
      finish(answers);
    },
  });
  const auth = p.auth || 'auto';
  if ((auth === 'auto' || auth === 'agent') && process.env.SSH_AUTH_SOCK) methods.push({ type: 'agent', username, agent: process.env.SSH_AUTH_SOCK });
  if (auth === 'key' && p.keyFile) {
    const k = await loadKey(s, p.keyFile, p.passphrase); if (k) methods.push({ type: 'publickey', username, key: k.key, passphrase: k.passphrase });
  }
  if (auth === 'auto') for (const f of defaultKeys()) {
    const raw = fs.readFileSync(f); const parsed = sshUtils.parseKey(raw);
    if (!(parsed instanceof Error)) methods.push({ type: 'publickey', username, key: raw });
  }
  if (auth === 'password' || auth === 'auto') {
    let pw = p.password;
    if (!pw && auth === 'password') pw = await s.ask('secret', { title: 'Password', label: `Password for ${username}@${host}` });
    if (pw) methods.push({ type: 'password', username, password: pw });
    methods.push(kbd(pw));
  }
  if (auth === 'key' || auth === 'agent') methods.push(kbd(p.password));
  if (!methods.length) methods.push(kbd(null));
  let askedPw = false;

  const conn = new Client();
  s.conn = conn;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    conn.on('banner', (msg) => s.log('Server banner:\n' + msg.trim()));
    conn.on('ready', () => {
      s.log(`Authenticated. Session established with ${hostId}.`, 'ok');
      broadcast(s, 'ssh:state', { connected: true });
      finish({ ok: true });
    });
    conn.on('error', (err) => {
      s.log(`Error: ${err.message}`, 'error');
      finish({ ok: false, error: err.message });
    });
    conn.on('close', () => {
      if (s.conn === conn) { s.log('Connection closed.', 'warn'); s.teardown(); broadcast(s, 'ssh:state', { connected: false }); }
      finish({ ok: false, error: 'Connection closed' });
    });
    conn.on('tcp connection', (info, accept, reject) => {
      const fwd = [...s.forwards.values()].find((f) => f.type === 'remote' && f.bindPort === info.destPort);
      if (!fwd) return reject();
      const ch = accept(); const sock = net.connect(fwd.destPort, fwd.destHost);
      sock.on('error', () => ch.close()); ch.on('error', () => sock.destroy());
      ch.pipe(sock).pipe(ch);
    });

    conn.connect({
      host, port, username,
      readyTimeout: 20000,
      keepaliveInterval: (Number(p.keepalive) || 30) * 1000,
      tryKeyboard: true,
      compress: !!p.compression,
      hostVerifier: (key, cb) => {
        const fp = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
        const known = readJSON(KNOWN_HOSTS_FILE, {});
        if (known[hostId] === fp) { s.log(`Host key verified: ${fp}`); return cb(true); }
        const changed = !!known[hostId];
        s.ask('hostkey', { host: hostId, fingerprint: fp, previous: known[hostId] || null, changed }).then((ans) => {
          if (ans === 'accept-save' || ans === 'accept-once') {
            if (ans === 'accept-save') { known[hostId] = fp; writeJSON(KNOWN_HOSTS_FILE, known); }
            s.log(`Host key ${changed ? 'CHANGED and ' : ''}accepted: ${fp}`, changed ? 'warn' : 'info');
            cb(true);
          } else { s.log('Host key rejected by user.', 'error'); cb(false); }
        });
      },
      // Must return undefined (not a Promise) so ssh2 waits for next().
      authHandler: (methodsLeft, partial, next) => {
        (async () => {
          while (methods.length) {
            const m = methods.shift();
            if (methodsLeft && !methodsLeft.includes(m.type)) continue; // server doesn't offer it
            s.log(`Trying authentication: ${m.type}`);
            return next(m);
          }
          // Last chance: ask for a password once.
          if (!askedPw && (!methodsLeft || methodsLeft.includes('password'))) {
            askedPw = true;
            const pw = await s.ask('secret', { title: 'Password', label: `Password for ${username}@${host}` });
            if (pw) return next({ type: 'password', username, password: pw });
          }
          next(false);
        })();
      },
    });
  });
});

ipcMain.handle('ssh:disconnect', (e) => { const s = S(e); s.log('Disconnecting...'); s.teardown(); broadcast(s, 'ssh:state', { connected: false }); });

// ---------- shells ----------
ipcMain.handle('shell:open', (e, { cols, rows, term }) => {
  const s = S(e);
  if (!s.conn) throw new Error('Not connected');
  const id = s.nextId++;
  return new Promise((resolve, reject) => {
    s.conn.shell({ term: term || 'xterm-256color', cols, rows }, (err, stream) => {
      if (err) return reject(err);
      const wc = e.sender;
      const out = (ch, payload) => { if (!wc.isDestroyed()) wc.send(ch, payload); };
      s.shells.set(id, { stream, wcId: wc.id });
      stream.on('data', (d) => out('shell:data', { id, data: d.toString('utf8') }));
      stream.stderr.on('data', (d) => out('shell:data', { id, data: d.toString('utf8') }));
      stream.on('close', () => { s.shells.delete(id); out('shell:exit', { id }); });
      s.log(`Terminal #${id} opened.`);
      resolve(id);
    });
  });
});
ipcMain.on('shell:write', (e, { id, data }) => S(e).shells.get(id)?.stream.write(data));
ipcMain.on('shell:resize', (e, { id, cols, rows }) => S(e).shells.get(id)?.stream.setWindow(rows, cols, 0, 0));
ipcMain.on('shell:close', (e, { id }) => { const st = S(e).shells.get(id); if (st) st.stream.end(); });

// ---------- exec (for quick remote commands, e.g. disk usage) ----------
ipcMain.handle('ssh:exec', (e, cmd) => {
  const s = S(e);
  return new Promise((resolve, reject) => {
    s.conn.exec(cmd, (err, st) => {
      if (err) return reject(err);
      let out = ''; st.on('data', (d) => (out += d)); st.stderr.on('data', (d) => (out += d));
      st.on('close', (code) => resolve({ code, out }));
    });
  });
});

// ---------- local filesystem ----------
function modeStr(mode, isDir) {
  const r = (b, c) => (mode & b ? c : '-');
  return (isDir ? 'd' : '-') + r(256, 'r') + r(128, 'w') + r(64, 'x') + r(32, 'r') + r(16, 'w') + r(8, 'x') + r(4, 'r') + r(2, 'w') + r(1, 'x');
}
ipcMain.handle('local:home', () => os.homedir());
ipcMain.handle('local:downloads', () => { const d = app.getPath('downloads'); return fs.existsSync(d) ? d : os.homedir(); });
ipcMain.handle('local:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('local:list', async (_e, dir) => {
  const names = await fsp.readdir(dir);
  const out = [];
  await Promise.all(names.map(async (name) => {
    try {
      const st = await fsp.stat(path.join(dir, name));
      out.push({ name, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, perm: modeStr(st.mode, st.isDirectory()) });
    } catch { out.push({ name, dir: false, size: 0, mtime: 0, perm: '?', broken: true }); }
  }));
  return { path: path.resolve(dir), entries: out };
});
ipcMain.handle('local:mkdir', (_e, p) => fsp.mkdir(p));
ipcMain.handle('local:rename', (_e, a, b) => fsp.rename(a, b));
ipcMain.handle('local:delete', (_e, p) => fsp.rm(p, { recursive: true, force: true }));
ipcMain.handle('local:open', (_e, p) => shell.openPath(p));

// ---------- remote filesystem ----------
const rjoin = (...a) => path.posix.join(...a);
const sp = (fn) => new Promise((res, rej) => fn((err, v) => (err ? rej(err) : res(v))));

ipcMain.handle('sftp:realpath', async (e, p) => { const sf = await S(e).getSftp(); return sp((cb) => sf.realpath(p || '.', cb)); });
ipcMain.handle('sftp:list', async (e, dir) => {
  const sf = await S(e).getSftp();
  const real = await sp((cb) => sf.realpath(dir, cb));
  const list = await sp((cb) => sf.readdir(real, cb));
  const entries = await Promise.all(list.map(async (it) => {
    let isDir = it.attrs.isDirectory(); let link = false;
    if (it.attrs.isSymbolicLink()) {
      link = true;
      try { isDir = (await sp((cb) => sf.stat(rjoin(real, it.filename), cb))).isDirectory(); } catch {}
    }
    return { name: it.filename, dir: isDir, link, size: it.attrs.size, mtime: it.attrs.mtime * 1000, perm: modeStr(it.attrs.mode, isDir), mode: it.attrs.mode & 0o7777 };
  }));
  return { path: real, entries };
});
ipcMain.handle('sftp:mkdir', async (e, p) => { const sf = await S(e).getSftp(); return sp((cb) => sf.mkdir(p, cb)); });
ipcMain.handle('sftp:rename', async (e, a, b) => { const sf = await S(e).getSftp(); return sp((cb) => sf.rename(a, b, cb)); });
ipcMain.handle('sftp:chmod', async (e, p, mode) => { const sf = await S(e).getSftp(); return sp((cb) => sf.chmod(p, mode, cb)); });
async function rmRemote(sf, p) {
  const st = await sp((cb) => sf.lstat(p, cb));
  if (st.isDirectory()) {
    for (const it of await sp((cb) => sf.readdir(p, cb))) await rmRemote(sf, rjoin(p, it.filename));
    await sp((cb) => sf.rmdir(p, cb));
  } else await sp((cb) => sf.unlink(p, cb));
}
ipcMain.handle('sftp:delete', async (e, p) => rmRemote(await S(e).getSftp(), p));

// Open remote file in a local editor; re-upload on save.
ipcMain.handle('sftp:edit', async (e, remote) => {
  const s = S(e); const sf = await s.getSftp();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'x-ssh-'));
  const local = path.join(dir, path.posix.basename(remote));
  await sp((cb) => sf.fastGet(remote, local, cb));
  let timer = null;
  const w = fs.watch(local, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { await sp((cb) => sf.fastPut(local, remote, cb)); s.log(`Saved ${remote} (uploaded edit).`, 'ok'); }
      catch (err) { s.log(`Upload of edited ${remote} failed: ${err.message}`, 'error'); }
    }, 400);
  });
  s.watchers.set(local, w);
  s.log(`Editing ${remote} locally — changes upload on save.`);
  await shell.openPath(local);
});

// ---------- transfers ----------
ipcMain.on('xfer:cancel', (e, id) => S(e).cancelled.add(id));

async function collectLocal(src, dstBase, list) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    list.push({ dir: true, dst: dstBase });
    for (const n of await fsp.readdir(src)) await collectLocal(path.join(src, n), rjoin(dstBase, n), list);
  } else list.push({ src, dst: dstBase, size: st.size });
}
async function collectRemote(sf, src, dstBase, list) {
  const st = await sp((cb) => sf.stat(src, cb));
  if (st.isDirectory()) {
    list.push({ dir: true, dst: dstBase });
    for (const it of await sp((cb) => sf.readdir(src, cb))) await collectRemote(sf, rjoin(src, it.filename), path.join(dstBase, it.filename), list);
  } else list.push({ src, dst: dstBase, size: st.size });
}

ipcMain.handle('xfer:start', async (e, { id, direction, sources, destDir, overwrite }) => {
  const s = S(e); const sf = await s.getSftp();
  const items = [];
  for (const src of sources) {
    if (direction === 'upload') await collectLocal(src, rjoin(destDir, path.basename(src)), items);
    else await collectRemote(sf, src, path.join(destDir, path.posix.basename(src)), items);
  }
  const total = items.reduce((a, b) => a + (b.size || 0), 0);
  let doneBytes = 0; let files = 0; let skipped = 0;
  const nfiles = items.filter((i) => !i.dir).length;
  const progress = (current) => !e.sender.isDestroyed() && e.sender.send('xfer:progress', { id, total, done: doneBytes + current, files, nfiles, file: currentName });
  let currentName = '';
  let lastSent = 0;
  for (const it of items) {
    if (s.cancelled.has(id)) { s.cancelled.delete(id); s.log(`Transfer cancelled.`, 'warn'); return { ok: false, cancelled: true }; }
    if (it.dir) {
      try {
        if (direction === 'upload') await sp((cb) => sf.mkdir(it.dst, cb));
        else await fsp.mkdir(it.dst, { recursive: true });
      } catch { /* exists */ }
      continue;
    }
    currentName = path.basename(it.src);
    if (!overwrite) {
      const exists = direction === 'upload'
        ? await sp((cb) => sf.stat(it.dst, cb)).then(() => true, () => false)
        : fs.existsSync(it.dst);
      if (exists) { skipped++; doneBytes += it.size; files++; continue; }
    }
    const step = (transferred) => { const now = Date.now(); if (now - lastSent > 100) { lastSent = now; progress(transferred); } };
    if (direction === 'upload') await sp((cb) => sf.fastPut(it.src, it.dst, { step, concurrency: 64 }, cb));
    else await sp((cb) => sf.fastGet(it.src, it.dst, { step, concurrency: 64 }, cb));
    doneBytes += it.size; files++;
    progress(0);
  }
  s.log(`${direction === 'upload' ? 'Uploaded' : 'Downloaded'} ${files - skipped} file(s)${skipped ? `, skipped ${skipped} existing` : ''} (${(total / 1048576).toFixed(2)} MB) → ${destDir}`, 'ok');
  return { ok: true };
});

// ---------- port forwarding ----------
function socks5Handler(s, sock) {
  // Minimal SOCKS5 (no auth, CONNECT) + SOCKS4/4a, tunnelled through SSH direct-tcpip.
  sock.once('data', (buf) => {
    const tunnel = (host, port, okReply, failReply, rest) => {
      s.conn.forwardOut('127.0.0.1', 0, host, port, (err, ch) => {
        if (err) { sock.end(failReply); return; }
        sock.write(okReply);
        if (rest && rest.length) ch.write(rest);
        sock.pipe(ch).pipe(sock);
        ch.on('error', () => sock.destroy()); sock.on('error', () => ch.close());
      });
    };
    if (buf[0] === 4) { // SOCKS4 / 4a
      const port = buf.readUInt16BE(2); let host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
      let i = 8; while (buf[i] !== 0 && i < buf.length) i++;
      if (buf[4] === 0 && buf[5] === 0 && buf[6] === 0 && buf[7] !== 0) { const j = buf.indexOf(0, i + 1); host = buf.slice(i + 1, j).toString(); }
      const ok = Buffer.from([0, 0x5a, 0, 0, 0, 0, 0, 0]); const bad = Buffer.from([0, 0x5b, 0, 0, 0, 0, 0, 0]);
      return tunnel(host, port, ok, bad);
    }
    if (buf[0] !== 5) return sock.destroy();
    sock.write(Buffer.from([5, 0]));
    sock.once('data', (req) => {
      if (req[1] !== 1) return sock.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
      let host; let off;
      if (req[3] === 1) { host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`; off = 8; }
      else if (req[3] === 3) { const l = req[4]; host = req.slice(5, 5 + l).toString(); off = 5 + l; }
      else if (req[3] === 4) { host = req.slice(4, 20).toString('hex').match(/.{4}/g).join(':'); off = 20; }
      else return sock.destroy();
      const port = req.readUInt16BE(off);
      const ok = Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]); const bad = Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]);
      tunnel(host, port, ok, bad);
    });
  });
  sock.on('error', () => {});
}

ipcMain.handle('fwd:start', async (e, f) => {
  const s = S(e);
  if (!s.conn) throw new Error('Not connected');
  const id = s.nextId++;
  const bindHost = f.bindHost || '127.0.0.1';
  if (f.type === 'remote') {
    await sp((cb) => s.conn.forwardIn(bindHost, Number(f.bindPort), cb));
    s.forwards.set(id, { ...f, bindPort: Number(f.bindPort), destPort: Number(f.destPort) });
    s.log(`Remote forward ${bindHost}:${f.bindPort} (server) → ${f.destHost}:${f.destPort} (local) active.`, 'ok');
    return id;
  }
  const server = net.createServer((sock) => {
    if (f.type === 'dynamic') return socks5Handler(s, sock);
    s.conn.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, f.destHost, Number(f.destPort), (err, ch) => {
      if (err) { s.log(`Forward to ${f.destHost}:${f.destPort} failed: ${err.message}`, 'error'); return sock.destroy(); }
      sock.pipe(ch).pipe(sock);
      ch.on('error', () => sock.destroy()); sock.on('error', () => ch.close());
    });
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(Number(f.bindPort), bindHost, res); });
  s.forwards.set(id, { ...f, server });
  s.log(f.type === 'dynamic'
    ? `SOCKS proxy listening on ${bindHost}:${f.bindPort}.`
    : `Local forward ${bindHost}:${f.bindPort} → ${f.destHost}:${f.destPort} (via server) active.`, 'ok');
  return id;
});
ipcMain.handle('fwd:stop', async (e, id) => {
  const s = S(e); const f = s.forwards.get(id); if (!f) return;
  if (f.server) f.server.close();
  else if (s.conn) s.conn.unforwardIn(f.bindHost || '127.0.0.1', f.bindPort, () => {});
  s.forwards.delete(id);
  s.log(`Forward on port ${f.bindPort} stopped.`);
});
