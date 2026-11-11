const { app, BrowserWindow, BrowserView, ipcMain, session, Menu } = require('electron');
const { installChromeWebStore } = require('electron-chrome-web-store');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const path = require('path');
const fs = require('fs');
const i18n = require('./i18n');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const START_URL = 'aeroium://start';
const THEMES = new Set(['dark', 'light', 'nord', 'rose']);
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
const MAX_NOTE_LENGTH = 20000;

const READER_SCRIPT = `
  (() => {
    const root = document.querySelector('article') || document.body;
    const paragraphs = Array.from(root.querySelectorAll('p'))
      .map(p => (p.innerText || '').trim())
      .filter(Boolean);
    if (paragraphs.length === 0) return 0;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:800px;margin:40px auto;padding:0 20px;font-family:Georgia,serif;';
    const h1 = document.createElement('h1');
    h1.style.cssText = 'margin-bottom:24px;font-size:32px;';
    h1.textContent = document.title || '';
    wrap.appendChild(h1);
    for (const text of paragraphs) {
      const p = document.createElement('p');
      p.style.cssText = 'margin-bottom:16px;line-height:1.6;font-size:18px;';
      p.textContent = text;
      wrap.appendChild(p);
    }
    document.body.replaceChildren(wrap);
    return paragraphs.length;
  })()
`;

const tabs = new Map();
const notes = new Map();
let win = null;
let ui = null;
let activeId = null;
let nextId = 1;
let modalOpen = false;
let lang = 'en';
let strings = {};
let attached = null; // the BrowserView currently shown on top of the UI

// Set once the app is ready; session.defaultSession can't be read before that.
let browserSession = null;

Menu.setApplicationMenu(null);

function t(key, vars) {
  let s = strings[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

function enableAdblocker() {
  try {
    ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
      blocker.enableBlockingInSession(browserSession);
    }).catch(() => console.log('Adblocker yüklenemedi.'));
  } catch (e) {}
}

// Only web pages and Aeroium's own start page may be opened from user input.
function safeUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === START_URL || s === 'about:blank') return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
}

function notify(message) {
  if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('show-notification', message);
}

function layout() {
  if (!win || !ui) return;
  const [w, h] = win.getContentSize();
  ui.setBounds({ x: 0, y: 0, width: w, height: h });
  if (attached) attached.setBounds({ x: 0, y: 64, width: w, height: h - 64 });
}

function list() {
  return [...tabs].map(([id, t]) => ({ id, title: t.title, url: t.url, active: id === activeId }));
}

function sync() {
  if (!ui || ui.webContents.isDestroyed()) return;
  const t = activeId !== null ? tabs.get(activeId) : null;
  ui.webContents.send('tabs', list());
  ui.webContents.send('url', t ? t.url : '');
  ui.webContents.send('is-local-page', !!t && t.url === START_URL);
}

// Shows the active tab below the UI, or hides it while a modal is open so the
// modal is not covered by the page.
function showActive() {
  if (!win) return;
  const t = activeId !== null ? tabs.get(activeId) : null;
  const want = t && !modalOpen ? t.v : null;
  if (attached && attached !== want) {
    win.removeBrowserView(attached);
    attached = null;
  }
  if (want && want !== attached) {
    win.addBrowserView(want);
    attached = want;
  }
  layout();
}

function activate(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  showActive();
  sync();
}

function activeWebContents() {
  const t = activeId !== null ? tabs.get(activeId) : undefined;
  return t && !t.v.webContents.isDestroyed() ? t.v.webContents : null;
}

function loadStart(wc) {
  wc.loadFile(path.join(__dirname, 'renderer', 'start.html')).catch(() => {});
}

function close(id) {
  const t = tabs.get(id);
  if (!t) return;
  if (attached === t.v) {
    win.removeBrowserView(t.v);
    attached = null;
  }
  if (!t.v.webContents.isDestroyed()) t.v.webContents.destroy();
  tabs.delete(id);
  if (activeId === id) {
    const next = tabs.keys().next().value;
    activeId = next !== undefined ? next : null;
  }
  showActive();
  sync();
}

// Creates a tab for an already-validated URL.
function createTab(url) {
  const id = nextId++;
  const v = new BrowserView({
    webPreferences: {
      session: browserSession,
      // Only exposes a tiny API to Aeroium's own start page (file:// origin).
      preload: path.join(__dirname, 'site-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  const wc = v.webContents;
  tabs.set(id, { v, title: url === START_URL ? 'Aeroium' : t('tab.newTab'), url });

  wc.setWindowOpenHandler(({ url: target }) => {
    newTab(target);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, target) => {
    if (!safeUrl(target)) event.preventDefault();
  });

  wc.on('page-title-updated', (_e, title) => {
    const t = tabs.get(id);
    if (!t) return;
    t.title = title || t('tab.newTab');
    sync();
  });

  const onNavigate = (u) => {
    const t = tabs.get(id);
    if (!t) return;
    t.url = u.startsWith('file:') ? START_URL : u;
    sync();
  };
  wc.on('did-navigate', (_e, u) => onNavigate(u));
  wc.on('did-navigate-in-page', (_e, u) => onNavigate(u));

  // Ctrl+K should open the command palette even when the page has focus.
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (ui && !ui.webContents.isDestroyed()) {
        ui.webContents.focus();
        ui.webContents.send('open-cmd');
      }
    }
  });

  if (url === START_URL) loadStart(wc);
  else wc.loadURL(url).catch(() => {});

  activate(id);
  return id;
}

function newTab(raw) {
  return createTab(safeUrl(raw) || START_URL);
}

function navigateActive(text) {
  const wc = activeWebContents();
  if (!wc || typeof text !== 'string') return;
  const q = text.trim();
  if (!q) return;
  if (q === START_URL) return loadStart(wc);

  const looksLikeUrl = /^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})(\/.*)?$/i.test(q);
  let target = null;
  if (looksLikeUrl) target = safeUrl(/^https?:\/\//i.test(q) ? q : `https://${q}`);
  if (!target) target = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  wc.loadURL(target).catch(() => {});
}

function runInActive(script) {
  const wc = activeWebContents();
  if (wc) wc.executeJavaScript(script).catch(() => {});
}

function listExtensions() {
  try {
    return typeof browserSession.getAllExtensions === 'function' ? browserSession.getAllExtensions() : [];
  } catch (err) {
    console.error('Eklentiler okunamadı:', err);
    return [];
  }
}

app.whenReady().then(async () => {
  browserSession = session.defaultSession;
  lang = i18n.resolveLang(app.getLocale());
  strings = i18n.loadStrings(lang);
  enableAdblocker();

  // Deny every browser permission request (camera, mic, location, notifications...)
  // unless it is on the explicit allowlist.
  browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  browserSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  // electron-chrome-web-store 0.13 calls session.serviceWorkers.startWorkerForScope,
  // which this Electron version does not provide. Without this stub the call throws
  // and the store stops loading extensions. A real fix is upgrading Electron.
  if (browserSession.serviceWorkers && typeof browserSession.serviceWorkers.startWorkerForScope !== 'function') {
    browserSession.serviceWorkers.startWorkerForScope = async () => {};
  }

  try {
    await installChromeWebStore({ session: browserSession, allowUnsupportedExtensions: true });
  } catch (err) {
    console.error('Chrome Web Mağazası yüklenemedi:', err);
  }

  win = new BrowserWindow({
    width: 1366,
    height: 768,
    title: 'Aeroium',
    frame: false,
    backgroundColor: '#1e1e24',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });

  // The Chrome extension layer adds a 'closed' listener per window; raise the
  // default limit (10) so Electron does not warn about a normal number of listeners.
  win.setMaxListeners(30);

  ui = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.addBrowserView(ui);
  ui.webContents.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('resize', layout);
  ui.webContents.once('did-finish-load', () => {
    layout();
    newTab(START_URL);
  });
});

ipcMain.handle('nt', (_e, u) => newTab(u));
ipcMain.on('ct', (_e, id) => close(id));
ipcMain.on('at', (_e, id) => activate(id));
ipcMain.on('nv', (_e, text) => navigateActive(text));

// navigationHistory is the non-deprecated API; fall back to webContents on older Electron.
function history(wc) {
  return wc.navigationHistory || wc;
}

ipcMain.on('bk', () => {
  const wc = activeWebContents();
  if (wc && history(wc).canGoBack()) history(wc).goBack();
});
ipcMain.on('fw', () => {
  const wc = activeWebContents();
  if (wc && history(wc).canGoForward()) history(wc).goForward();
});
ipcMain.on('rl', () => {
  const wc = activeWebContents();
  if (wc) wc.reload();
});

ipcMain.on('speedup', () => {
  runInActive(`
    (() => {
      const videos = document.querySelectorAll('video');
      let speed = 1;
      if (videos.length > 0) {
        if (videos[0].playbackRate === 1) speed = 1.5;
        else if (videos[0].playbackRate === 1.5) speed = 2;
        videos.forEach(v => v.playbackRate = speed);
      }
      return speed;
    })()
  `);
});

ipcMain.on('darkmode', () => {
  runInActive(`
    (() => {
      if (document.documentElement.style.filter === 'invert(1) hue-rotate(180deg)') {
        document.documentElement.style.filter = 'none';
        document.documentElement.style.backgroundColor = '#ffffff';
      } else {
        document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
        document.documentElement.style.backgroundColor = '#000000';
      }
    })()
  `);
});

ipcMain.on('readermode', () => {
  const wc = activeWebContents();
  if (!wc) return;
  wc.executeJavaScript(READER_SCRIPT)
    .then((count) => { if (!count) notify(t('reader.noText')); })
    .catch(() => {});
});

ipcMain.handle('get-note', () => {
  if (activeId === null || !tabs.has(activeId)) return '';
  return notes.get(tabs.get(activeId).url) || '';
});

ipcMain.on('save-note', (_e, text) => {
  if (activeId === null || !tabs.has(activeId) || typeof text !== 'string') return;
  const url = tabs.get(activeId).url;
  const value = text.slice(0, MAX_NOTE_LENGTH);
  if (value.trim() === '') notes.delete(url);
  else notes.set(url, value);
});

ipcMain.on('apply-theme', (_e, theme) => {
  if (typeof theme === 'string' && THEMES.has(theme) && ui && !ui.webContents.isDestroyed()) {
    ui.webContents.send('theme-changed', theme);
  }
});

ipcMain.on('show-notification', (_e, message) => {
  if (typeof message === 'string') notify(message.slice(0, 200));
});

// The UI tells us when a modal is open so the page view can get out of the way.
ipcMain.on('modal-state', (_e, open) => {
  modalOpen = open === true;
  showActive();
});

// Only names and ids go to the renderer; the URL is resolved here.
ipcMain.handle('get-extensions', () => {
  return listExtensions().map((ext) => ({ id: ext.id, name: ext.name || t('ext.unnamed') }));
});

ipcMain.on('open-extension', (_e, id) => {
  if (typeof id !== 'string' || !/^[a-p]{32}$/.test(id)) return;
  const ext = listExtensions().find((x) => x.id === id);
  if (!ext) return notify(t('ext.notFound'));

  const m = ext.manifest || {};
  const page = (m.options_ui && m.options_ui.page) || m.options_page ||
    (m.action && m.action.default_popup) ||
    (m.browser_action && m.browser_action.default_popup) ||
    (m.page_action && m.page_action.default_popup);
  if (!page) return notify(t('ext.noPage'));

  createTab(`chrome-extension://${id}/${page}`);
});

ipcMain.handle('get-i18n', () => ({ lang, dir: i18n.isRtl(lang) ? 'rtl' : 'ltr', strings }));

const extensionsDir = () => path.resolve(app.getPath('userData'), 'Extensions');

// Unloads an extension and deletes its files. Only paths inside Aeroium's own
// extensions folder are ever removed.
ipcMain.handle('remove-extension', async (_e, id) => {
  if (typeof id !== 'string' || !/^[a-p]{32}$/.test(id)) return false;
  try {
    const root = extensionsDir();
    const dir = path.resolve(root, id);
    if (!dir.startsWith(root + path.sep)) return false;
    if (typeof browserSession.removeExtension === 'function') {
      try { browserSession.removeExtension(id); } catch (err) { /* not loaded; files may still exist */ }
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error('Eklenti kaldırılamadı:', err);
    return false;
  }
});

ipcMain.handle('open-webstore', () => {
  newTab('https://chromewebstore.google.com/');
});

ipcMain.on('min', () => win && win.minimize());
ipcMain.on('max', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('close-win', () => win && win.close());

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
