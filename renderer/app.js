/* X-SSH renderer — PuTTY-style config, Bitvise-style log + tabs, xterm terminals, dual-pane SFTP. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => { if (n == null) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + ' ' + u[i]; };
const fmtDate = (ms) => { if (!ms) return ''; const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

const MODE = new URLSearchParams(location.search).get('mode') || 'main'; // main | term | sftp
document.body.classList.add(MODE === 'main' ? 'mode-main' : 'child', 'mode-' + MODE);
const state = { connected: false, connecting: false, profile: null, tabs: [], active: 'login', grid: false, tunnels: [], selectedProfile: null };

// ================= modal helpers =================
function modal({ title, html = '', inputs = [], buttons = [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: null }], cls = '' }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${cls}"><h3>${esc(title)}</h3>${html}
      ${inputs.map((i, n) => `<label>${esc(i.label)}<input data-n="${n}" type="${i.type || 'text'}" value="${esc(i.value || '')}"></label>`).join('')}
      <div class="btns">${buttons.map((b, n) => `<button data-b="${n}" class="${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${esc(b.label)}</button>`).join('')}</div></div>`;
    $('#modalRoot').appendChild(bg);
    const ins = $$('input', bg);
    const close = (b) => {
      bg.remove();
      if (b == null || b.value == null) return resolve(null);
      resolve(inputs.length ? (b.value === true ? (inputs.length === 1 ? ins[0].value : ins.map((i) => i.value)) : b.value) : b.value);
    };
    $$('button', bg).forEach((el) => (el.onclick = () => close(buttons[el.dataset.b])));
    bg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(buttons.find((b) => b.primary) || buttons[0]); }
      if (e.key === 'Escape') close(null);
    });
    (ins[0] || $('button.primary', bg) || $('button', bg)).focus();
    if (ins[0]) ins[0].select();
  });
}
const confirmBox = (title, text, okLabel = 'OK', danger = false) => modal({ title, html: `<p>${esc(text)}</p>`, buttons: [{ label: okLabel, value: true, primary: !danger, danger }, { label: 'Cancel', value: null }] });
const inputBox = (title, label, value = '') => modal({ title, inputs: [{ label, value }] });

// Prompts that originate in the main process (host key, passwords, keyboard-interactive)
api.onPrompt(async (p) => {
  let v = null;
  if (p.kind === 'hostkey') {
    const html = p.changed
      ? `<p>⚠ The host key for <b>${esc(p.host)}</b> has CHANGED. This could mean someone is intercepting the connection (man-in-the-middle), or the server was reinstalled.</p>
         Previously trusted:<code class="bad">${esc(p.previous)}</code>Offered now:<code>${esc(p.fingerprint)}</code>`
      : `<p>The server <b>${esc(p.host)}</b> is not yet trusted. Verify its fingerprint before accepting:</p><code>${esc(p.fingerprint)}</code>`;
    v = await modal({ title: p.changed ? 'HOST KEY MISMATCH' : 'Unknown host key', html, cls: p.changed ? 'warnbox' : '',
      buttons: [{ label: 'Accept & save', value: 'accept-save', primary: !p.changed, danger: p.changed }, { label: 'Accept once', value: 'accept-once' }, { label: 'Reject', value: null }] });
  } else {
    v = await modal({ title: p.title || 'Input required', inputs: [{ label: p.label, type: p.kind === 'secret' ? 'password' : 'text' }] });
  }
  api.replyPrompt(p.id, v);
});

// ================= context menu =================
function ctxMenu(x, y, items) {
  const m = $('#ctxMenu');
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<div data-i="${i}" class="${it.disabled ? 'dis' : ''}">${esc(it.label)}</div>`)).join('');
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  $$('div', m).forEach((d) => (d.onclick = () => { m.hidden = true; items[d.dataset.i].action(); }));
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxMenu')) $('#ctxMenu').hidden = true; });

// ================= log =================
api.onLog(({ t, level, msg }) => log(msg, level, t));
function log(msg, level = 'info', t = Date.now()) {
  const el = document.createElement('div');
  el.className = level;
  el.innerHTML = `<span class="t">${new Date(t).toLocaleTimeString()}</span>${esc(msg)}`;
  const box = $('#log'); box.appendChild(el); box.scrollTop = box.scrollHeight;
  const cs = $('#childStatus'); if (cs) { cs.textContent = msg; cs.className = level; }
}
$('#clearLog').onclick = () => ($('#log').innerHTML = '');

// ================= config form =================
const FIELDS = ['name', 'host', 'port', 'username', 'auth', 'password', 'savePassword', 'keyFile', 'passphrase', 'keepalive', 'compression',
  'openTerm', 'openSftp', 'autoTunnels', 'term', 'scrollback', 'font', 'fontSize', 'scheme', 'cursor', 'copyOnSelect', 'rightPaste',
  'remoteDir', 'localDir', 'showHidden', 'overwrite'];
const DEFAULTS = {};
FIELDS.forEach((f) => { const el = $('#f_' + f); DEFAULTS[f] = el.type === 'checkbox' ? el.checked : el.value; });

function getForm() {
  const p = {};
  for (const f of FIELDS) { const el = $('#f_' + f); p[f] = el.type === 'checkbox' ? el.checked : el.value; }
  p.port = Number(p.port) || 22; p.fontSize = Number(p.fontSize) || 14; p.scrollback = Number(p.scrollback) || 10000;
  p.tunnels = state.tunnels.map(({ type, bindHost, bindPort, destHost, destPort, enabled }) => ({ type, bindHost, bindPort, destHost, destPort, enabled }));
  return p;
}
function setForm(p) {
  for (const f of FIELDS) {
    const el = $('#f_' + f); const v = p[f] ?? DEFAULTS[f];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  }
  state.tunnels = (p.tunnels || []).map((t) => ({ ...t, fwdId: null, status: '' }));
  renderTunnels();
  updateTarget();
}

$$('#catList li').forEach((li) => (li.onclick = () => {
  $$('#catList li').forEach((x) => x.classList.toggle('sel', x === li));
  $$('.cat').forEach((c) => (c.hidden = c.dataset.cat !== li.dataset.cat));
  if (li.dataset.cat === 'hostkeys') renderHostKeys();
}));

// ---- saved sessions ----
let profiles = [];
async function refreshProfiles() {
  profiles = (await api.profiles.list()).sort((a, b) => a.name.localeCompare(b.name));
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ['#89b4fa', '#cba6f7', '#94e2d5', '#a6e3a1', '#f9e2af', '#fab387', '#f5c2e7', '#89dceb'][h % 8]; };
  $('#profileList').innerHTML = profiles.map((p) => `<li data-name="${esc(p.name)}" class="card ${p.name === state.selectedProfile ? 'sel' : ''}" title="Double-click to connect">
      <span class="av" style="background:${hue(p.name)}">${esc(p.name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?')}</span>
      <span class="meta"><div class="nm">${esc(p.name)}</div><div class="hs">${esc(p.username || '?')}@${esc(p.host)}${p.port && p.port != 22 ? ':' + esc(p.port) : ''}</div></span>
      <button class="go primary" title="Connect">${ICON('play')}</button></li>`).join('')
    || '<li class="empty">No saved sessions yet — fill in a destination and hit Save.</li>';
  $$('#profileList li[data-name]').forEach((li) => {
    li.onclick = (e) => {
      state.selectedProfile = li.dataset.name; $('#f_name').value = li.dataset.name;
      $$('#profileList li').forEach((x) => x.classList.toggle('sel', x === li));
      if (e.target.closest('.go')) { loadProfile(li.dataset.name); login(); }
    };
    li.ondblclick = (e) => { if (!e.target.closest('.go')) { loadProfile(li.dataset.name); login(); } };
  });
}
function loadProfile(name) {
  const p = profiles.find((x) => x.name === name); if (!p) return;
  setForm(p); state.selectedProfile = name; log(`Loaded session "${name}".`);
}
$('#pLoad').onclick = () => state.selectedProfile && loadProfile(state.selectedProfile);
$('#pSave').onclick = async () => {
  const p = getForm();
  if (!p.name) p.name = $('#f_name').value = p.username && p.host ? `${p.username}@${p.host}` : p.host;
  if (!p.name) return log('Enter a host before saving.', 'warn');
  const r = await api.profiles.save(p);
  state.selectedProfile = p.name;
  log(`Saved session "${p.name}".${p.savePassword && !r.encrypted ? ' (No system keyring available — password NOT stored.)' : ''}`, 'ok');
  refreshProfiles();
};
$('#pDelete').onclick = async () => {
  const n = state.selectedProfile; if (!n) return;
  if (await confirmBox('Delete session', `Delete saved session "${n}"?`, 'Delete', true)) { await api.profiles.remove(n); state.selectedProfile = null; refreshProfiles(); }
};
$('#pOpenWin').onclick = () => api.newWindow(state.selectedProfile || undefined);
$('#pExport').onclick = async () => { if (await api.profiles.export()) log('Sessions exported (passwords excluded).', 'ok'); };
$('#pImport').onclick = async () => { const n = await api.profiles.import(); if (n) { log(`Imported ${n} session(s).`, 'ok'); refreshProfiles(); } };
$('#browseKey').onclick = async () => { const f = await api.pickKeyFile(); if (f) { $('#f_keyFile').value = f; $('#f_auth').value = 'key'; } };

// ---- host keys ----
async function renderHostKeys() {
  const hk = await api.hostkeys.list();
  $('#hkList').innerHTML = Object.entries(hk).map(([h, fp]) => `<tr><td>${esc(h)}</td><td><code>${esc(fp)}</code></td><td><button class="icon" data-h="${esc(h)}">Remove</button></td></tr>`).join('')
    || '<tr><td colspan="3" class="hint">No trusted hosts yet.</td></tr>';
  $$('#hkList button').forEach((b) => (b.onclick = async () => { await api.hostkeys.remove(b.dataset.h); renderHostKeys(); }));
}

// ---- tunnels ----
function renderTunnels() {
  $('#fwdList').innerHTML = state.tunnels.map((t, i) => `<tr>
    <td><input type="checkbox" data-en="${i}" ${t.enabled ? 'checked' : ''}></td>
    <td>${{ local: 'Local', remote: 'Remote', dynamic: 'SOCKS' }[t.type]}</td>
    <td>${esc(t.bindHost)}:${esc(t.bindPort)}</td>
    <td>${t.type === 'dynamic' ? '—' : esc(t.destHost) + ':' + esc(t.destPort)}</td>
    <td><span class="badge ${t.fwdId ? 'on' : t.status ? 'err' : ''}" title="${esc(t.status || '')}">${t.fwdId ? 'active' : t.status ? 'error' : 'idle'}</span></td>
    <td>${state.connected ? `<button class="icon" data-tg="${i}">${t.fwdId ? 'Stop' : 'Start'}</button>` : ''} <button class="icon" data-rm="${i}">✕</button></td></tr>`).join('')
    || '<tr><td colspan="6" class="hint">No tunnels defined.</td></tr>';
  $$('[data-en]').forEach((c) => (c.onchange = () => (state.tunnels[c.dataset.en].enabled = c.checked)));
  $$('[data-rm]').forEach((b) => (b.onclick = async () => { const t = state.tunnels[b.dataset.rm]; if (t.fwdId) await api.fwd.stop(t.fwdId); state.tunnels.splice(b.dataset.rm, 1); renderTunnels(); }));
  $$('[data-tg]').forEach((b) => (b.onclick = () => toggleTunnel(state.tunnels[b.dataset.tg])));
}
async function toggleTunnel(t) {
  if (t.fwdId) { await api.fwd.stop(t.fwdId); t.fwdId = null; t.status = ''; }
  else {
    try { t.fwdId = await api.fwd.start({ type: t.type, bindHost: t.bindHost, bindPort: t.bindPort, destHost: t.destHost, destPort: t.destPort }); t.status = ''; }
    catch (e) { t.status = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); log(`Tunnel ${t.bindPort}: ${t.status}`, 'error'); }
  }
  renderTunnels();
}
$('#t_add').onclick = () => {
  const t = { type: $('#t_type').value, bindHost: $('#t_bindHost').value || '127.0.0.1', bindPort: $('#t_bindPort').value, destHost: $('#t_destHost').value || 'localhost', destPort: $('#t_destPort').value, enabled: true };
  if (!t.bindPort || (t.type !== 'dynamic' && !t.destPort)) return log('Tunnel needs a listen port and (unless SOCKS) a destination port.', 'warn');
  state.tunnels.push(t); renderTunnels();
  if (state.connected) toggleTunnel(t);
};
$('#t_type').onchange = () => { const d = $('#t_type').value === 'dynamic'; $('#t_destHost').disabled = d; $('#t_destPort').disabled = d; };

// ================= connection =================
function setStatus() {
  const st = $('#status');
  st.className = state.connected ? 'on' : state.connecting ? 'busy' : '';
  $('#statusText').textContent = state.connected ? `${state.profile.username}@${state.profile.host}:${state.profile.port}` : state.connecting ? 'Connecting…' : 'Disconnected';
  const lbl = state.connected ? 'Log out' : state.connecting ? 'Connecting…' : 'Log in';
  for (const b of [$('#btnLogin'), $('#btnLogin2')]) { b.innerHTML = ICON('power') + ' ' + lbl; b.disabled = state.connecting; b.classList.toggle('danger', state.connected); b.classList.toggle('primary', !state.connected); }
  updateTarget();
  $('#btnNewTerm').disabled = $('#btnNewSftp').disabled = !state.connected;
  $('#btnGrid').disabled = !state.connected;
  document.title = state.connected ? `${state.profile.username}@${state.profile.host} — X-SSH` : 'X-SSH';
}
async function login() {
  if (state.connected) return logout();
  const p = getForm();
  if (!p.host) { log('Enter a host name first.', 'warn'); $('#f_host').focus(); return; }
  if (!p.username) { const u = await inputBox('Username', `Login as (on ${p.host}):`); if (!u) return; p.username = $('#f_username').value = u; }
  state.connecting = true; state.profile = p; setStatus();
  const r = await api.connect(p);
  state.connecting = false;
  if (!r.ok) { log(`Login failed: ${r.error}`, 'error'); setStatus(); return; }
  state.connected = true; setStatus();
  if (p.autoTunnels) for (const t of state.tunnels) if (t.enabled && !t.fwdId) await toggleTunnel(t);
  renderTunnels();
  if (p.openTerm) newTerminal();
  if (p.openSftp) newSftp();
}
async function logout() {
  if (state.tabs.some((t) => t.kind === 'term' && t.alive) && !(await confirmBox('Log out', 'Close the SSH session and all its terminals?', 'Log out', true))) return;
  await api.disconnect();
}
api.onState(({ connected }) => {
  state.connected = connected;
  if (!connected) {
    state.tunnels.forEach((t) => { t.fwdId = null; });
    state.tabs.forEach((t) => { if (t.kind === 'term') t.markDead(); if (t.kind === 'sftp') t.disable(); });
    renderTunnels();
  }
  setStatus();
});
$('#btnLogin').onclick = $('#btnLogin2').onclick = login;
$('#btnNewWin').onclick = () => api.newWindow();
$('#btnNewTerm').onclick = () => newTerminal();
$('#btnNewSftp').onclick = () => newSftp();
$('#btnGrid').onclick = async () => { const n = await api.tileWindows(); if (!n) log('No terminal/SFTP windows open to tile.', 'warn'); };
['host', 'port', 'username', 'password'].forEach((f) => $('#f_' + f).addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); }));

// ================= tabs =================
let tabSeq = 0;
function addTab(tab) {
  tab.key = 't' + ++tabSeq;
  tab.tabEl = document.createElement('div');
  tab.tabEl.className = `tab kind-${tab.kind}`;
  tab.tabEl.innerHTML = `<span></span><b class="x" title="Close">×</b>`;
  tab.setTitle = (s) => { tab.title = s; $('span', tab.tabEl).textContent = s; if (tab.titleEl) tab.titleEl.textContent = s; if (MODE !== 'main') document.title = s; };
  tab.setTitle(tab.title);
  tab.tabEl.onclick = (e) => { if (e.target.classList.contains('x')) closeTab(tab); else activate(tab.key); };
  tab.tabEl.onauxclick = (e) => { if (e.button === 1) closeTab(tab); };
  tab.tabEl.oncontextmenu = (e) => ctxMenu(e.clientX, e.clientY, [
    { label: 'Rename tab…', action: async () => { const n = await inputBox('Rename tab', 'Title', tab.title); if (n) { tab.customTitle = true; tab.setTitle(n); } } },
    ...(tab.kind === 'term' ? [{ label: 'Duplicate terminal', action: () => newTerminal(), disabled: !state.connected }] : []),
    { label: 'Close', action: () => closeTab(tab) },
    { label: 'Close others', action: () => state.tabs.filter((t) => t !== tab).forEach((t) => closeTab(t, true)) },
  ]);
  $('#tabs').appendChild(tab.tabEl);
  $('#workspace').appendChild(tab.pane);
  state.tabs.push(tab);
  activate(tab.key);
  setStatus();
}
function activate(key) {
  state.active = key;
  $$('#tabs .tab').forEach((el) => el.classList.remove('active'));
  if (key === 'login') {
    $('#tabs .tab[data-tab=login]').classList.add('active');
    if (state.grid) toggleGrid(false);
  }
  const tab = state.tabs.find((t) => t.key === key);
  if (tab) {
    tab.tabEl.classList.add('active');
    if (state.grid && tab.kind !== 'term') toggleGrid(false);
  }
  $$('#workspace > .pane').forEach((p) => p.classList.toggle('active', key === 'login' ? p.id === 'pane-login' : tab && p === tab.pane));
  $$('#workspace > .pane.term').forEach((p) => p.classList.toggle('focus', tab && p === tab.pane));
  if (tab?.onShow) requestAnimationFrame(() => tab.onShow());
}
$('#tabs .tab[data-tab=login]').onclick = () => activate('login');
async function closeTab(tab, force) {
  if (tab.kind === 'term' && tab.alive && !force && !(await confirmBox('Close terminal', `Close "${tab.title}"? The remote shell will be terminated.`, 'Close'))) return;
  tab.dispose?.();
  tab.tabEl.remove(); tab.pane.remove();
  state.tabs = state.tabs.filter((t) => t !== tab);
  if (state.active === tab.key) { const last = state.tabs[state.tabs.length - 1]; activate(last ? last.key : 'login'); }
  if (state.grid) layoutGrid();
  setStatus();
  if (MODE !== 'main' && !state.tabs.length) window.close();
}
function toggleGrid(force) {
  state.grid = force ?? !state.grid;
  $('#workspace').classList.toggle('grid', state.grid);
  $('#btnGrid').classList.toggle('primary', state.grid);
  if (state.grid) {
    const cur = state.tabs.find((t) => t.key === state.active);
    if (!cur || cur.kind !== 'term') { const t = state.tabs.find((x) => x.kind === 'term'); if (t) activate(t.key); }
    layoutGrid();
  } else { $('#workspace').style.gridTemplateColumns = ''; activate(state.active); }
}
function layoutGrid() {
  const n = state.tabs.filter((t) => t.kind === 'term').length;
  if (n < 2) return toggleGrid(false);
  const cols = Math.ceil(Math.sqrt(n));
  $('#workspace').style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  $('#workspace').style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, 1fr)`;
  requestAnimationFrame(() => state.tabs.forEach((t) => t.kind === 'term' && t.onShow()));
}

// ================= terminals =================
const SCHEMES = {
  Mocha: { background: '#11111b', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#585b70', black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de', brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8' },
  PuTTY: { background: '#000000', foreground: '#bbbbbb', cursor: '#00ff00', selectionBackground: '#555555', black: '#000000', red: '#bb0000', green: '#00bb00', yellow: '#bbbb00', blue: '#0000bb', magenta: '#bb00bb', cyan: '#00bbbb', white: '#bbbbbb', brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55', brightYellow: '#ffff55', brightBlue: '#5555ff', brightMagenta: '#ff55ff', brightCyan: '#55ffff', brightWhite: '#ffffff' },
  Dracula: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' },
  'Solarized Dark': { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  Light: { background: '#fafafa', foreground: '#383a42', cursor: '#526eff', selectionBackground: '#cfd6e6', black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401', blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#a0a1a7', brightBlack: '#4f525e', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' },
};
const shellMap = new Map(); // shellId -> TermTab
let termCount = 0;

// In the session window these open separate OS windows sharing the SSH connection (Bitvise style).
function newTerminal(extra) {
  if (!state.connected) return;
  return api.openChild('term', getForm(), extra).catch((e) => log(cleanErr(e), 'error'));
}
function newSftp() {
  if (!state.connected) return;
  return api.openChild('sftp', getForm()).catch((e) => log(cleanErr(e), 'error'));
}

async function createTerminalTab(extra = {}) {
  if (!state.connected) return;
  const p = state.profile; const cfg = getForm();
  const tab = { kind: 'term', title: `${p.username}@${p.host} (${++termCount})`, alive: false };
  tab.pane = document.createElement('section');
  tab.pane.className = 'pane term';
  tab.pane.innerHTML = `<div class="term-head"><span class="dot"></span><span class="term-title"></span><span class="chip host">${esc(p.username)}@${esc(p.host)}:${esc(p.port)}</span><span class="chip size"></span><span class="sp"></span>
      <button data-h="find" title="Find (Ctrl+Shift+F)">${ICON('search')}</button><button data-h="term" title="New terminal window (Ctrl+Shift+T)">${ICON('terminal')} New</button>
      <button data-h="sftp" title="Open SFTP window (Ctrl+Shift+S)">${ICON('transfer')} SFTP</button><button data-h="session" title="Show session window">${ICON('server')}</button></div>
    <div class="term-search">${ICON('search')}<input placeholder="Find in scrollback…  (Enter / Shift+Enter)"><button class="icon" data-d="prev">${ICON('chevUp')}</button><button class="icon" data-d="next">${ICON('chevDown')}</button><button class="icon" data-d="close">${ICON('x')}</button></div><div class="term-host"></div>`;
  tab.titleEl = $('.term-title', tab.pane);
  $$('.term-head button', tab.pane).forEach((b) => (b.onclick = () => ({ find: () => showSearch(), term: () => newTerminal(), sftp: () => newSftp(), session: () => api.focusSession() })[b.dataset.h]()));
  const term = new Terminal({
    fontFamily: cfg.font, fontSize: cfg.fontSize, scrollback: cfg.scrollback, cursorStyle: cfg.cursor, cursorBlink: true,
    theme: SCHEMES[cfg.scheme] || SCHEMES.Mocha, allowProposedApi: true, rightClickSelectsWord: false, macOptionIsMeta: true,
  });
  const fit = new FitAddon.FitAddon(); const search = new SearchAddon.SearchAddon();
  term.loadAddon(fit); term.loadAddon(search); term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => window.open(uri)));
  tab.term = term;
  addTab(tab);
  term.open($('.term-host', tab.pane));
  fit.fit();

  tab.onShow = () => { try { fit.fit(); } catch {} if (!state.grid || state.active === tab.key) term.focus(); };
  let fitPending = false;
  new ResizeObserver(() => { if (fitPending) return; fitPending = true; requestAnimationFrame(() => { fitPending = false; if (tab.pane.offsetParent) try { fit.fit(); } catch {} }); }).observe($('.term-host', tab.pane));
  const sizeChip = $('.chip.size', tab.pane);
  sizeChip.textContent = `${term.cols}×${term.rows}`;
  term.onResize(({ cols, rows }) => { sizeChip.textContent = `${cols}×${rows}`; if (tab.shellId) api.shell.resize(tab.shellId, cols, rows); });
  term.onData((d) => tab.alive && api.shell.write(tab.shellId, d));
  term.onTitleChange((t) => { if (!tab.customTitle && t) tab.setTitle(t); });
  term.textarea?.addEventListener('focus', () => { if (state.grid && state.active !== tab.key) activate(tab.key); });

  // PuTTY-style clipboard: copy on select, right-click paste. Plus Ctrl+Shift+C/V/F.
  term.onSelectionChange(() => { if (cfg.copyOnSelect && term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(() => {}); });
  const paste = async () => { const t = await navigator.clipboard.readText().catch(() => ''); if (t && tab.alive) term.paste(t); };
  $('.term-host', tab.pane).addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (cfg.rightPaste && !e.shiftKey) return paste();
    ctxMenu(e.clientX, e.clientY, [
      { label: 'Copy', action: () => navigator.clipboard.writeText(term.getSelection()), disabled: !term.hasSelection() },
      { label: 'Paste', action: paste },
      { label: 'Find…', action: () => showSearch() }, '-',
      { label: 'Clear scrollback', action: () => term.clear() },
      { label: 'Reset terminal', action: () => term.reset() },
      { label: 'Reconnect shell', action: () => reopen(), disabled: tab.alive || !state.connected }, '-',
      { label: 'New terminal window', action: () => newTerminal(), disabled: !state.connected },
      { label: 'New SFTP window', action: () => newSftp(), disabled: !state.connected },
      { label: 'Show session window', action: () => api.focusSession() },
    ]);
  });
  const sbox = $('.term-search', tab.pane); const sinput = $('input', sbox);
  const showSearch = () => { sbox.classList.add('show'); sinput.focus(); sinput.select(); requestAnimationFrame(() => fit.fit()); };
  const hideSearch = () => { sbox.classList.remove('show'); search.clearDecorations?.(); term.focus(); requestAnimationFrame(() => fit.fit()); };
  sinput.onkeydown = (e) => { if (e.key === 'Enter') (e.shiftKey ? search.findPrevious : search.findNext).call(search, sinput.value); if (e.key === 'Escape') hideSearch(); };
  $$('button', sbox).forEach((b) => (b.onclick = () => (b.dataset.d === 'close' ? hideSearch() : b.dataset.d === 'prev' ? search.findPrevious(sinput.value) : search.findNext(sinput.value))));
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
    const k = e.key.toLowerCase();
    if (k === 'c') { if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()); return false; }
    if (k === 'v') { paste(); return false; }
    if (k === 'f') { showSearch(); return false; }
    return true;
  });

  tab.markDead = () => {
    if (!tab.alive) return;
    tab.alive = false; tab.tabEl.classList.add('dead'); $('.term-head', tab.pane).classList.add('dead'); shellMap.delete(tab.shellId);
    term.write('\r\n\x1b[1;31m[session closed — right-click → Reconnect shell, or close the tab]\x1b[0m\r\n');
  };
  tab.dispose = () => { if (tab.alive) api.shell.close(tab.shellId); shellMap.delete(tab.shellId); term.dispose(); };
  async function reopen() {
    try {
      tab.shellId = await api.shell.open({ cols: term.cols, rows: term.rows, term: cfg.term });
      shellMap.set(tab.shellId, tab); tab.alive = true; tab.tabEl.classList.remove('dead'); $('.term-head', tab.pane).classList.remove('dead');
      term.focus();
    } catch (e) { term.write(`\r\n\x1b[31mFailed to open shell: ${e.message}\x1b[0m\r\n`); }
  }
  await reopen();
  if (extra.cd && tab.alive) api.shell.write(tab.shellId, ` cd '${extra.cd.replace(/'/g, "'\\''")}' && clear\n`);
}
api.onShellData(({ id, data }) => shellMap.get(id)?.term.write(data));
api.onShellExit(({ id }) => {
  const t = shellMap.get(id); if (!t) return;
  t.markDead();
  // PuTTY/Bitvise behaviour: typing `exit` closes the terminal window (but keep it open if the whole connection dropped).
  if (MODE === 'term') setTimeout(() => { if (state.connected && state.tabs.length === 1) window.close(); }, 400);
});

// ================= SFTP =================
const XFER_PROGRESS = new Map();
api.onXfer((p) => XFER_PROGRESS.get(p.id)?.(p));
let xferSeq = 0;

class FilePane {
  constructor(sftp, side) {
    this.sftp = sftp; this.side = side; this.cwd = ''; this.entries = []; this.sel = new Set(); this.sort = { k: 'name', asc: true }; this.anchor = null;
    this.el = document.createElement('div'); this.el.className = 'fpane';
    this.el.innerHTML = `<div class="fp-head"><span class="lbl ${side}">${ICON(side === 'local' ? 'monitor' : 'server')}${side === 'local' ? 'This PC' : esc(state.profile?.host || 'Server')}</span>
        <button data-a="up" title="Parent folder (Backspace)">${ICON('up')}</button><button data-a="home" title="${side === 'local' ? 'Downloads' : 'Home'}">${ICON('home')}</button>
        <div class="pathbox"><div class="crumbs" title="Click a folder to jump; click empty space to type a path"></div><input class="path" spellcheck="false"></div>
        <button data-a="refresh" title="Refresh (F5)">${ICON('refresh')}</button>
        <button data-a="mkdir" title="New folder">${ICON('folderPlus')}</button></div>
      <div class="fp-list" tabindex="0"><table><thead><tr><th data-k="name">Name</th><th data-k="size">Size</th><th data-k="mtime">Modified</th><th data-k="perm">Permissions</th></tr></thead><tbody></tbody></table></div>
      <div class="fp-foot"></div>`;
    this.api = side === 'local' ? api.local : api.remote;
    this.sep = '/';
    const pb = $('.pathbox', this.el); const pin = $('.path', this.el);
    const editPath = () => { pb.classList.add('edit'); pin.value = this.cwd; pin.focus(); pin.select(); };
    $('.crumbs', this.el).onclick = (e) => { const c = e.target.closest('.c'); if (c) this.go(c.dataset.p); else editPath(); };
    pin.onkeydown = (e) => { if (e.key === 'Enter') { pb.classList.remove('edit'); this.go(e.target.value); } if (e.key === 'Escape') pb.classList.remove('edit'); };
    pin.onblur = () => pb.classList.remove('edit');
    $$('.fp-head button', this.el).forEach((b) => (b.onclick = () => this.action(b.dataset.a)));
    $$('th', this.el).forEach((th) => (th.onclick = () => { const k = th.dataset.k; this.sort = { k, asc: this.sort.k === k ? !this.sort.asc : true }; this.render(); }));
    const list = $('.fp-list', this.el);
    list.onkeydown = (e) => this.onKey(e);
    list.oncontextmenu = (e) => { if (!e.target.closest('tr[data-i]')) { this.sel.clear(); this.render(); } this.menu(e); };
    // drag & drop
    list.addEventListener('dragover', (e) => { e.preventDefault(); this.el.classList.add('drop'); });
    list.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    list.addEventListener('drop', (e) => this.onDrop(e));
  }
  join(a, b) { return a.endsWith('/') ? a + b : a + '/' + b; }
  parent(p) { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
  async go(p) {
    try {
      const r = await this.api.list(p);
      this.cwd = r.path; this.entries = r.entries; this.sel.clear(); this.anchor = null;
      $('.path', this.el).value = this.cwd; this.renderCrumbs(); this.render();
    } catch (e) { log(`${this.side}: cannot open ${p}: ${cleanErr(e)}`, 'error'); $('.path', this.el).value = this.cwd; }
  }
  refresh() { return this.cwd && this.go(this.cwd); }
  visible() {
    const hidden = $('#f_showHidden').checked;
    const v = this.entries.filter((e) => hidden || !e.name.startsWith('.'));
    const { k, asc } = this.sort;
    v.sort((a, b) => (b.dir - a.dir) || ((k === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)));
    return v;
  }
  renderCrumbs() {
    const parts = this.cwd.split('/').filter(Boolean);
    let acc = '';
    const segs = [`<span class="c ${parts.length ? '' : 'last'}" data-p="/">/</span>`].concat(parts.map((p, i) => {
      acc += '/' + p;
      return `${i ? '<span class="sep">›</span>' : ''}<span class="c ${i === parts.length - 1 ? 'last' : ''}" data-p="${esc(acc)}">${esc(p)}</span>`;
    }));
    $('.crumbs', this.el).innerHTML = `<span class="inner">${segs.join('')}</span><span class="fill"></span>`;
    $('.crumbs', this.el).style.justifyContent = 'flex-start';
    const cr = $('.crumbs', this.el); cr.scrollLeft = cr.scrollWidth;
  }
  render() {
    this.view = this.visible();
    const tb = $('tbody', this.el);
    tb.innerHTML = `<tr data-up="1"><td colspan="4"><span class="ficon">${ICON('up')}</span>..</td></tr>` + this.view.map((e, i) =>
      `<tr data-i="${i}" draggable="true" class="${e.dir ? 'd' : ''} ${this.sel.has(e.name) ? 'sel' : ''}"><td title="${esc(e.name)}">${fileIcon(e.name, e.dir)}${esc(e.name)}${e.link ? `<span class="lnk" title="symlink">${ICON('link')}</span>` : ''}</td>
       <td class="num">${e.dir ? '' : fmtSize(e.size)}</td><td class="date">${fmtDate(e.mtime)}</td><td class="perm">${esc(e.perm)}</td></tr>`).join('');
    $$('th', this.el).forEach((th) => (th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.k === this.sort.k ? (this.sort.asc ? ' ▲' : ' ▼') : '')));
    $('tr[data-up]', tb).ondblclick = () => this.go(this.parent(this.cwd));
    $$('tr[data-i]', tb).forEach((tr) => {
      const e = this.view[tr.dataset.i];
      tr.onmousedown = (ev) => { if (ev.button === 2 && this.sel.has(e.name)) return; this.select(e, ev); };
      tr.ondblclick = () => this.open(e);
      tr.ondragstart = (ev) => {
        if (!this.sel.has(e.name)) { this.sel = new Set([e.name]); this.render(); }
        ev.dataTransfer.setData('application/x-x-ssh', JSON.stringify({ sftp: this.sftp.id, side: this.side, paths: this.selectedPaths() }));
        ev.dataTransfer.effectAllowed = 'copy';
      };
    });
    const files = this.entries.filter((e) => !e.dir).length;
    const selSize = this.entries.filter((e) => this.sel.has(e.name)).reduce((a, b) => a + (b.dir ? 0 : b.size), 0);
    $('.fp-foot', this.el).textContent = `${this.entries.length - files} folders, ${files} files` + (this.sel.size ? ` — ${this.sel.size} selected (${fmtSize(selSize)})` : '');
  }
  select(e, ev) {
    const names = this.view.map((x) => x.name);
    if (ev.shiftKey && this.anchor) {
      const a = names.indexOf(this.anchor), b = names.indexOf(e.name);
      if (!ev.ctrlKey) this.sel.clear();
      names.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((n) => this.sel.add(n));
    } else if (ev.ctrlKey) { this.sel.has(e.name) ? this.sel.delete(e.name) : this.sel.add(e.name); this.anchor = e.name; }
    else { this.sel = new Set([e.name]); this.anchor = e.name; }
    this.render();
  }
  selectedPaths() { return [...this.sel].map((n) => this.join(this.cwd, n)); }
  selectedEntries() { return this.entries.filter((e) => this.sel.has(e.name)); }
  open(e) {
    if (e.dir) return this.go(this.join(this.cwd, e.name));
    if (this.side === 'local') api.local.open(this.join(this.cwd, e.name));
    else api.remote.edit(this.join(this.cwd, e.name)).catch((err) => log(`Edit failed: ${cleanErr(err)}`, 'error'));
  }
  async action(a) {
    if (a === 'up') return this.go(this.parent(this.cwd));
    if (a === 'home') return this.go(this.side === 'local' ? await api.local.downloads() : await api.remote.realpath('.'));
    if (a === 'refresh') return this.refresh();
    if (a === 'mkdir') { const n = await inputBox('New folder', 'Folder name'); if (n) await this.api.mkdir(this.join(this.cwd, n)).catch((e) => log(cleanErr(e), 'error')); return this.refresh(); }
    if (a === 'rename') {
      const [e] = this.selectedEntries(); if (!e) return;
      const n = await inputBox('Rename', 'New name', e.name);
      if (n && n !== e.name) await this.api.rename(this.join(this.cwd, e.name), this.join(this.cwd, n)).catch((er) => log(cleanErr(er), 'error'));
      return this.refresh();
    }
    if (a === 'delete') {
      const sel = this.selectedPaths(); if (!sel.length) return;
      if (!(await confirmBox('Delete', `Permanently delete ${sel.length} item(s) on the ${this.side} side?\n\n${sel.slice(0, 8).join('\n')}${sel.length > 8 ? '\n…' : ''}`, 'Delete', true))) return;
      for (const p of sel) await this.api.remove(p).catch((e) => log(`Delete ${p}: ${cleanErr(e)}`, 'error'));
      log(`Deleted ${sel.length} item(s).`, 'ok');
      return this.refresh();
    }
    if (a === 'chmod') {
      const [e] = this.selectedEntries(); if (!e) return;
      const v = await inputBox('Permissions', `Octal mode for ${e.name}`, (e.mode ?? 0o644).toString(8));
      if (v && /^[0-7]{3,4}$/.test(v)) { await api.remote.chmod(this.join(this.cwd, e.name), parseInt(v, 8)).catch((er) => log(cleanErr(er), 'error')); this.refresh(); }
    }
    if (a === 'transfer') this.sftp.transfer(this.side === 'local' ? 'upload' : 'download', this.selectedPaths());
    if (a === 'copypath') navigator.clipboard.writeText(this.selectedPaths().join('\n') || this.cwd);
    if (a === 'terminal') newTerminal({ cd: this.cwd });
  }
  menu(e) {
    e.preventDefault();
    const n = this.sel.size; const remote = this.side === 'remote';
    ctxMenu(e.clientX, e.clientY, [
      { label: remote ? `⬇ Download ${n || ''}` : `⬆ Upload ${n || ''}`, action: () => this.action('transfer'), disabled: !n },
      { label: remote ? 'Edit / open locally' : 'Open', action: () => this.open(this.selectedEntries()[0]), disabled: n !== 1 }, '-',
      { label: 'Rename… (F2)', action: () => this.action('rename'), disabled: n !== 1 },
      { label: 'Delete (Del)', action: () => this.action('delete'), disabled: !n },
      ...(remote ? [{ label: 'Permissions…', action: () => this.action('chmod'), disabled: n !== 1 }] : []),
      { label: 'New folder', action: () => this.action('mkdir') },
      { label: 'Copy path', action: () => this.action('copypath') },
      ...(remote ? [{ label: 'Open terminal here', action: () => this.action('terminal') }] : []), '-',
      { label: 'Refresh (F5)', action: () => this.refresh() },
    ]);
  }
  onKey(e) {
    const v = this.view || [];
    if (e.key === 'F5') { e.preventDefault(); this.refresh(); }
    else if (e.key === 'Delete') this.action('delete');
    else if (e.key === 'F2') this.action('rename');
    else if (e.key === 'Backspace') this.go(this.parent(this.cwd));
    else if (e.key === 'Enter') { const s = this.selectedEntries(); if (s.length === 1) this.open(s[0]); }
    else if (e.key === 'a' && e.ctrlKey) { e.preventDefault(); this.sel = new Set(v.map((x) => x.name)); this.render(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let i = v.findIndex((x) => x.name === this.anchor); i = Math.max(0, Math.min(v.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (v[i]) { this.select(v[i], { shiftKey: e.shiftKey, ctrlKey: false }); this.anchor = v[i].name; $$('tr[data-i]', this.el)[i]?.scrollIntoView({ block: 'nearest' }); }
    }
  }
  onDrop(e) {
    e.preventDefault(); this.el.classList.remove('drop');
    const raw = e.dataTransfer.getData('application/x-x-ssh');
    if (raw) {
      const d = JSON.parse(raw);
      if (d.sftp === this.sftp.id && d.side !== this.side) this.sftp.transfer(this.side === 'remote' ? 'upload' : 'download', d.paths);
      return;
    }
    if (this.side === 'remote' && e.dataTransfer.files.length) { // dropped from the desktop / file manager
      const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
      if (paths.length) this.sftp.transfer('upload', paths);
    }
  }
}
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let sftpCount = 0;
async function createSftpTab() {
  if (!state.connected) return;
  const cfg = getForm();
  const tab = { kind: 'sftp', title: `SFTP ${state.profile.host}${++sftpCount > 1 ? ` (${sftpCount})` : ''}`, id: 'sftp' + sftpCount, queue: Promise.resolve() };
  tab.pane = document.createElement('section'); tab.pane.className = 'pane sftp';
  tab.pane.innerHTML = `<div class="sftp-main"></div><div class="queue"><div class="queue-head">${ICON('transfer')}<span>Transfers</span><span class="sp"></span><button class="link" data-a="clear">clear finished</button></div><div class="queue-list"></div></div>`;
  tab.local = new FilePane(tab, 'local'); tab.remote = new FilePane(tab, 'remote');
  const mid = document.createElement('div'); mid.className = 'mid-btns';
  mid.innerHTML = `<button title="Upload selected → server">${ICON('right')}</button><button title="Download selected ← to this PC">${ICON('left')}</button>`;
  const [bu, bd] = $$('button', mid);
  bu.onclick = () => tab.transfer('upload', tab.local.selectedPaths());
  bd.onclick = () => tab.transfer('download', tab.remote.selectedPaths());
  $('.sftp-main', tab.pane).append(tab.local.el, mid, tab.remote.el);
  $('[data-a=clear]', tab.pane).onclick = () => $$('.qi.done, .qi.fail', tab.pane).forEach((x) => x.remove());

  tab.transfer = (direction, sources) => {
    if (!sources.length) return log('Select files or folders first.', 'warn');
    if (!state.connected) return log('Not connected.', 'error');
    const destDir = direction === 'upload' ? tab.remote.cwd : tab.local.cwd;
    const id = ++xferSeq;
    const row = document.createElement('div'); row.className = 'qi';
    const label = sources.length === 1 ? sources[0].split('/').pop() : `${sources.length} items`;
    row.innerHTML = `<span class="dir ${direction === 'upload' ? 'up' : 'down'}">${ICON(direction)}</span><span class="name" title="${esc(sources.join('\n'))} → ${esc(destDir)}">${esc(label)} <small>→ ${esc(destDir)}</small></span><div class="bar"><i></i></div><span class="info">queued</span><button class="icon rm" title="Cancel">${ICON('x')}</button>`;
    $('.queue-list', tab.pane).prepend(row);
    let finished = false; const started = Date.now();
    $('.rm', row).onclick = () => { if (finished) row.remove(); else api.xfer.cancel(id); };
    XFER_PROGRESS.set(id, (p) => {
      const pct = p.total ? (p.done / p.total) * 100 : 100;
      const rate = p.done / Math.max(0.001, (Date.now() - started) / 1000);
      $('i', row).style.width = pct.toFixed(1) + '%';
      $('.info', row).textContent = `${p.files}/${p.nfiles} · ${fmtSize(rate)}/s`;
      $('.info', row).title = p.file;
    });
    tab.queue = tab.queue.then(async () => {
      $('.info', row).textContent = 'starting…';
      try {
        const r = await api.xfer.start({ id, direction, sources, destDir, overwrite: $('#f_overwrite').checked });
        row.classList.add(r.ok ? 'done' : 'fail'); $('i', row).style.width = '100%';
        $('.info', row).textContent = r.ok ? `done in ${((Date.now() - started) / 1000).toFixed(1)}s` : 'cancelled';
        if (r.ok && direction === 'download') {
          const where = destDir + '/' + sources[0].split('/').pop();
          const b = document.createElement('button'); b.className = 'icon'; b.innerHTML = ICON('folder'); b.title = 'Show in folder: ' + where;
          b.onclick = () => api.local.reveal(where);
          $('.info', row).after(b);
          log(`Saved to ${destDir}`, 'ok');
        }
      } catch (e) { row.classList.add('fail'); $('.info', row).textContent = 'failed'; $('.info', row).title = cleanErr(e); log(`Transfer failed: ${cleanErr(e)}`, 'error'); }
      finished = true; XFER_PROGRESS.delete(id); $('.rm', row).innerHTML = ICON('trash'); $('.rm', row).title = 'Remove from list';
      (direction === 'upload' ? tab.remote : tab.local).refresh();
    });
  };
  tab.disable = () => { tab.tabEl.classList.add('dead'); bu.disabled = bd.disabled = true; };
  addTab(tab);
  await tab.local.go(cfg.localDir || (await api.local.downloads()));
  await tab.remote.go(cfg.remoteDir || (await api.remote.realpath('.').catch(() => '/')));
}

// ================= global shortcuts =================
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (e.shiftKey && k === 't') { e.preventDefault(); newTerminal(); }
  else if (e.shiftKey && k === 's') { e.preventDefault(); newSftp(); }
  else if (e.shiftKey && k === 'w') { e.preventDefault(); const t = state.tabs.find((x) => x.key === state.active); if (t) closeTab(t); }
  else if (e.shiftKey && k === 'g') { e.preventDefault(); if (MODE === 'main') $('#btnGrid').click(); }
  else if (k === 'tab' || k === 'pageup' || k === 'pagedown') {
    e.preventDefault();
    const keys = ['login', ...state.tabs.map((t) => t.key)];
    const back = e.shiftKey || k === 'pageup';
    activate(keys[(keys.indexOf(state.active) + (back ? -1 : 1) + keys.length) % keys.length]);
  }
}, true);
if (MODE === 'main') window.addEventListener('beforeunload', () => api.disconnect());

// ================= boot =================
function updateTarget() {
  const el = $('#targetLine'); if (!el) return;
  const h = $('#f_host').value.trim(), u = $('#f_username').value.trim(), pt = $('#f_port').value;
  el.innerHTML = h ? `ssh <b>${esc(u || '?')}@${esc(h)}</b>${pt && pt != 22 ? ' -p ' + esc(pt) : ''}` : 'Enter a host to connect';
}
['host', 'username', 'port'].forEach((f) => $('#f_' + f).addEventListener('input', updateTarget));
hydrateIcons();

(async () => {
  if (MODE !== 'main') {
    const init = await api.childInit();
    if (!init) return window.close();
    setForm(init.cfg); state.profile = init.cfg; state.connected = true;
    if (init.kind === 'sftp') { const sb = document.createElement('div'); sb.id = 'childStatus'; document.body.appendChild(sb); await createSftpTab(); }
    else await createTerminalTab(init.extra);
    return;
  }
  await refreshProfiles();
  const want = new URLSearchParams(location.search).get('profile');
  if (want) { loadProfile(want); login(); }
  else { renderTunnels(); $('#f_host').focus(); }
  setStatus();
  log('X-SSH ready. Fill in the host or pick a saved session, then Log in.');
})();
