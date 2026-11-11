const A = window.aeroium;

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const ad = $('ad');
const cmdPalette = $('cmd-palette');
const cmdInput = $('cmd-input');
const cmdResults = $('cmd-results');
const notePanel = $('note-panel');
const noteText = $('note-text');
const toastContainer = $('toast-container');
const extPanel = $('ext-panel');
const extList = $('ext-list');
const modalsLayer = $('modals-layer');
const overlay = $('overlay');
const toolButtons = ['speedup', 'darkmode', 'readermode', 'note'].map($);

const THEMES = ['dark', 'light', 'nord', 'rose'];
let S = {};            // translated strings, filled from the main process
let currentTabs = [];

function t(key, vars) {
  let s = S[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

// Fills every element marked with data-i18n* attributes.
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = t(n.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); });
}

A.getI18n()
  .then(({ lang, dir, strings }) => {
    S = strings;
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    applyI18n();
  })
  .catch((err) => console.error('Dil yüklenemedi:', err));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', THEMES.includes(theme) ? theme : 'dark');
}
applyTheme(localStorage.getItem('aeroium-theme') || 'dark');
A.onThemeChanged(applyTheme);

A.onIsLocalPage((isLocal) => {
  toolButtons.forEach((btn) => btn.classList.toggle('hidden-tool', isLocal));
});

function showToast(message) {
  const toast = el('div', 'toast');
  toast.append(el('span', null, 'ℹ️'), el('span', null, message));
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
A.onNotification(showToast);

// --- Modal handling -------------------------------------------------------

const allPanels = [extPanel, notePanel, cmdPalette];

function isOpen(panel) {
  return !modalsLayer.classList.contains('hidden') && !panel.classList.contains('hidden');
}

function openModal(panel) {
  modalsLayer.classList.remove('hidden');
  allPanels.forEach((p) => p.classList.add('hidden'));
  panel.classList.remove('hidden');
  A.setModalOpen(true);
}

function closeModals() {
  modalsLayer.classList.add('hidden');
  allPanels.forEach((p) => p.classList.add('hidden'));
  A.setModalOpen(false);
}

overlay.onclick = closeModals;
$('note-close').onclick = closeModals;
$('ext-close').onclick = closeModals;

// --- Tabs and address bar --------------------------------------------------

A.onTabs((tabs) => {
  currentTabs = tabs;
  tabsEl.replaceChildren();
  for (const tb of tabs) {
    const tab = el('div', 'tab' + (tb.active ? ' on' : ''));
    const title = el('span', 't', tb.title || t('tab.newTab'));
    const close = el('span', 'x', '✕');
    tab.append(title, close);
    tab.onclick = (e) => {
      e.stopPropagation();
      if (e.target === close) A.close(tb.id);
      else A.activate(tb.id);
    };
    tabsEl.appendChild(tab);
  }
});

A.onUrl((u) => {
  if (document.activeElement !== ad) ad.value = u;
});

ad.onkeydown = (e) => {
  if (e.key === 'Enter') {
    A.nav(ad.value.trim());
    ad.blur();
  }
};

$('nt').onclick = () => A.newTab();
$('bk').onclick = () => A.back();
$('fw').onclick = () => A.fwd();
$('rl').onclick = () => A.reload();

$('min').onclick = () => A.min();
$('max').onclick = () => A.max();
$('close-win').onclick = () => A.closeWin();

$('speedup').onclick = () => A.speedUp();
$('darkmode').onclick = () => A.darkMode();
$('readermode').onclick = () => A.readerMode();

// --- Notes -----------------------------------------------------------------

$('note').onclick = async () => {
  if (isOpen(notePanel)) return closeModals();
  noteText.value = await A.getNote();
  openModal(notePanel);
  noteText.focus();
};

$('note-save').onclick = () => {
  A.saveNote(noteText.value);
  closeModals();
  showToast(t('note.saved'));
};

// --- Extensions ------------------------------------------------------------

function showExtMessage(text, isError = false) {
  const msg = el('div', 'ext-message', text);
  if (isError) msg.style.color = '#ff5555';
  extList.replaceChildren(msg);
}

function renderExtensions(exts) {
  if (exts.length === 0) {
    showExtMessage(t('ext.empty'));
    return;
  }
  extList.replaceChildren();
  for (const ext of exts) {
    const name = ext.name || t('ext.unnamed');
    const item = el('div', 'ext-item');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const letter = name.trim().charAt(0).toUpperCase() || '?';
    item.append(el('div', 'ext-icon', letter), el('div', 'ext-name', name));

    const launch = () => {
      A.openExtension(ext.id);
      closeModals();
    };
    item.onclick = launch;
    item.onkeydown = (e) => { if (e.key === 'Enter') launch(); };

    // Two clicks: the first arms the button, the second removes the extension.
    const removeBtn = el('button', 'ext-remove', t('ext.remove'));
    removeBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!removeBtn.classList.contains('armed')) {
        removeBtn.classList.add('armed');
        removeBtn.textContent = t('ext.confirmRemove');
        return;
      }
      removeBtn.disabled = true;
      const ok = await A.removeExtension(ext.id);
      showToast(t(ok ? 'ext.removed' : 'ext.removeFailed'));
      if (ok) openExtensions();
      else removeBtn.disabled = false;
    };
    item.appendChild(removeBtn);
    extList.appendChild(item);
  }
}

async function openExtensions() {
  openModal(extPanel);
  showExtMessage(t('ext.loading'));
  try {
    const exts = await A.getExtensions();
    if (!Array.isArray(exts)) throw new Error('invalid response');
    renderExtensions(exts);
  } catch (err) {
    console.error(err);
    showExtMessage(t('ext.error'), true);
  }
}

$('extensions').onclick = () => (isOpen(extPanel) ? closeModals() : openExtensions());

$('ext-store-btn').onclick = () => {
  closeModals();
  A.openWebStore();
};

// --- Command palette -------------------------------------------------------

function cmdItem(icon, label, onClick) {
  const item = el('div', 'cmd-item', `${icon} ${label}`);
  item.onclick = onClick;
  return item;
}

function renderCmdResults(query) {
  const q = query.trim();
  const needle = q.toLowerCase();
  cmdResults.replaceChildren();

  if (q) {
    cmdResults.appendChild(cmdItem('🔍', t('cmd.searchWeb', { query: q }), () => {
      A.nav(q);
      closeModals();
    }));
  }

  for (const tb of currentTabs) {
    const title = tb.title || t('tab.newTab');
    const url = tb.url || '';
    if (!needle || title.toLowerCase().includes(needle) || url.toLowerCase().includes(needle)) {
      cmdResults.appendChild(cmdItem('📄', title, () => {
        A.activate(tb.id);
        closeModals();
      }));
    }
  }
}

function openCmd() {
  openModal(cmdPalette);
  cmdInput.value = '';
  renderCmdResults('');
  cmdInput.focus();
}

cmdInput.oninput = () => renderCmdResults(cmdInput.value);
cmdInput.onkeydown = (e) => {
  if (e.key === 'Enter') {
    const first = cmdResults.querySelector('.cmd-item');
    if (first) first.click();
  }
};

A.onOpenCmd(() => {
  if (!isOpen(cmdPalette)) openCmd();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (isOpen(cmdPalette)) closeModals();
    else openCmd();
  } else if (e.key === 'Escape') {
    closeModals();
  }
});
