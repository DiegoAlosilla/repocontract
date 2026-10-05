import { blobLocation, validateContext } from './github.js';

const PREFIX = 'repocontract';
let state = { key: '', phase: 'idle', view: 'code' };
let generation = 0;
let timer;
let toolbar, panel, original, originalDisplay, controls;

function theme() {
  const root = document.documentElement;
  const mode = root.dataset.colorMode;
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function readContext() {
  const location = blobLocation(window.location.href);
  if (!location) return null;
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const route = data.payload?.codeViewLayoutRoute ?? data.payload?.codeViewBlobRoute ?? data.payload;
      const ref = route?.refInfo;
      if (!ref || !route.path) continue;
      return validateContext({ ...location, path: route.path, ref: ref.name, sha: ref.currentOid }, window.location.href);
    } catch { /* Payload belongs to the old route or is unrelated. */ }
  }
  // Old GitHub layouts expose a permalink with an unambiguous commit SHA.
  const permalink = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).find(href => {
    try { return new RegExp(`^/${location.owner}/${location.repo}/blob/[a-f0-9]{40}/`).test(new URL(href, window.location.href).pathname); } catch { return false; }
  });
  if (permalink) {
    const parts = new URL(permalink, window.location.href).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const path = parts.slice(4).join('/');
    const ref = location.tail.slice(0, -(path.length + 1));
    try { return validateContext({ ...location, path, ref, sha: parts[3] }, window.location.href); } catch { /* Wait for complete navigation. */ }
  }
  return null;
}

async function fetchContext(url) {
  // React may retain initial embeddedData. Only route metadata comes from HTML.
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('No se pudo recuperar el contexto del archivo desde GitHub. Recarga la página.');
  const html = await response.text();
  for (const match of html.matchAll(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      const route = data.payload?.codeViewLayoutRoute ?? data.payload?.codeViewBlobRoute ?? data.payload;
      if (!route?.refInfo || !route.path) continue;
      return validateContext({ ...blobLocation(url), path: route.path, ref: route.refInfo.name, sha: route.refInfo.currentOid }, url);
    } catch { /* No remote HTML is mounted or executed. */ }
  }
  throw new Error('GitHub no expuso la ruta y revisión del archivo. Recarga la página e inténtalo otra vez.');
}

function fileSurface() {
  // Prefer GitHub's file-only wrapper, leaving breadcrumbs and file controls visible.
  // Modern GitHub has a virtualized layer and a transparent textarea alongside
  // the SSR code. Hide the entire CodeBlob wrapper so none can cover the iframe.
  const code = document.querySelector('.react-code-file-contents');
  return code?.closest('[class*="CodeBlob-module__codeBlobWrapper"]') ??
    document.querySelector('[data-testid="file-viewer"]') ??
    document.querySelector('.react-code-view .react-code-file-contents') ??
    document.querySelector('.react-code-file-contents') ??
    document.querySelector('.js-file-content') ?? document.querySelector('.blob-wrapper');
}

function fileControls() {
  const raw = document.querySelector('[data-testid="raw-button"], a[data-testid="raw-button"], #raw-url') ??
    [...document.querySelectorAll('a[href]')].find(a => a.textContent.trim() === 'Raw' && /\/raw\/|raw\.githubusercontent\.com/.test(a.href));
  return raw?.closest('[role="group"]') ?? raw?.parentElement?.parentElement ??
    document.querySelector('[data-testid="file-header"] .d-flex, .file-actions');
}

function cleanup() {
  if (original?.isConnected) original.style.display = originalDisplay;
  toolbar?.remove(); panel?.remove();
  toolbar = panel = original = controls = null;
}

function button(label, callback) {
  const el = document.createElement('button');
  el.type = 'button'; el.className = `${PREFIX}-button`; el.textContent = label;
  el.addEventListener('click', callback);
  return el;
}

function renderToolbar() {
  controls = fileControls();
  if (!controls) return;
  toolbar = document.createElement('span');
  toolbar.id = `${PREFIX}-controls`;
  const toggle = button(state.view === 'api' ? 'Código' : 'Ver API', () => setView(state.view === 'api' ? 'code' : 'api'));
  toggle.id = `${PREFIX}-toggle`; toggle.setAttribute('aria-pressed', String(state.view === 'api'));
  toolbar.append(toggle);
  controls.append(toolbar);
}

function showError(message) {
  if (!panel) {
    const target = fileSurface();
    if (!target) return;
    panel = document.createElement('section'); panel.id = `${PREFIX}-panel`;
    target.before(panel);
  }
  panel.replaceChildren();
  panel.className = `${PREFIX}-notice`;
  panel.setAttribute('role', 'alert');
  const title = document.createElement('strong'); title.textContent = 'RepoContract';
  const text = document.createElement('p'); text.textContent = message;
  panel.append(title, text, button('Reintentar', () => scan(true)));
}

async function openTab() {
  if (!state.id) return { ok: false, error: state.error ?? 'Primero carga un contrato válido.' };
  return chrome.runtime.sendMessage({ type: 'OPEN_DOCUMENT', id: state.id, theme: theme() });
}

function setView(view) {
  if (state.phase !== 'ready') return { ok: false, error: state.error ?? 'El contrato aún no está disponible.' };
  const target = fileSurface();
  if (!target) return { ok: false, error: 'No se encontró el área del archivo. Recarga GitHub.' };
  if (view === 'api' && !panel) {
    original = target; originalDisplay = original.style.display;
    panel = document.createElement('section'); panel.id = `${PREFIX}-panel`;
    panel.className = `${PREFIX}-viewer`;
    const header = document.createElement('div'); header.className = `${PREFIX}-header`;
    const title = document.createElement('strong'); title.textContent = 'RepoContract';
    header.append(title, button('Código', () => setView('code')), button('Abrir en otra pestaña ↗', openTab));
    const frame = document.createElement('iframe');
    frame.id = `${PREFIX}-frame`; frame.title = `API · ${state.context.path}`;
    frame.src = chrome.runtime.getURL(`viewer.html?id=${state.id}&theme=${theme()}&embedded=1`);
    panel.append(header, frame); original.before(panel);
  }
  state.view = view;
  if (original) original.style.display = view === 'api' ? 'none' : originalDisplay;
  if (panel) panel.hidden = view !== 'api';
  const toggle = toolbar?.querySelector('button');
  if (toggle) { toggle.textContent = view === 'api' ? 'Código' : 'Ver API'; toggle.setAttribute('aria-pressed', String(view === 'api')); }
  return { ok: true };
}

async function scan(force = false) {
  const location = blobLocation(window.location.href);
  const key = location?.url ?? '';
  if (key !== state.key || force) {
    generation++; cleanup();
    state = { key, phase: 'idle', view: 'code' };
  }
  if (!location) return;
  if (!fileSurface()) return;
  let context = readContext() ?? (state.phase === 'ready' ? state.context : null);
  if (!context && state.phase === 'idle') {
    state.phase = 'context-loading';
    const epoch = generation;
    let failure;
    try { context = await fetchContext(key); }
    catch { failure = 'No se pudo recuperar la ruta y revisión desde GitHub. Comprueba la conexión o recarga la página.'; }
    if (epoch !== generation || blobLocation(window.location.href)?.url !== key) return;
    if (!context) {
      state.phase = 'error'; state.error = failure ?? 'No se pudo identificar la revisión del archivo. Recarga GitHub.';
      showError(state.error); return;
    }
    state.phase = 'idle';
  }
  if (!context) return;
  // Also detect a changed revision when GitHub refreshes the same branch URL.
  if (state.context && state.context.sha !== context.sha) {
    generation++; cleanup(); state = { key, phase: 'idle', view: 'code' };
  }
  if (state.phase === 'ready') {
    if (!toolbar?.isConnected || (original && !original.isConnected)) {
      const desired = state.view; cleanup(); state.view = 'code'; renderToolbar();
      if (desired === 'api') setView('api');
    }
    return;
  }
  if (state.phase !== 'idle' || !fileSurface()) return;
  state.phase = 'loading'; state.context = context;
  const epoch = generation;
  let result;
  try { result = await chrome.runtime.sendMessage({ type: 'READ_CONTRACT', context }); }
  catch { result = { ok: false, error: 'Recarga GitHub después de instalar o actualizar RepoContract.' }; }
  if (epoch !== generation || blobLocation(window.location.href)?.url !== key) return;
  if (!result.ok) {
    state.phase = 'error'; state.error = result.error;
    // Access errors apply to any candidate extension. Syntax errors identify a contract.
    showError(result.error); return;
  }
  if (!result.detected) { state.phase = 'unrelated'; return; }
  state = { ...state, ...result, phase: 'ready', view: 'code' };
  renderToolbar();
}

function schedule() { clearTimeout(timer); timer = setTimeout(() => scan(), 100); }
const observer = new MutationObserver(records => {
  if (records.some(record => !(record.target instanceof Element) || !record.target.closest(`#${PREFIX}-panel, #${PREFIX}-controls`))) schedule();
});
observer.observe(document.body, { childList: true, subtree: true });
for (const event of ['popstate', 'turbo:load', 'turbo:render', 'pjax:end']) window.addEventListener(event, schedule);
// pushState emits no standard event. Poll only the pathname, with no network traffic.
setInterval(() => { if ((blobLocation(window.location.href)?.url ?? '') !== state.key) scan(); }, 500);
new MutationObserver(() => {
  const frame = panel?.querySelector('iframe');
  frame?.contentWindow?.postMessage({ type: 'REPOCONTRACT_THEME', theme: theme() }, chrome.runtime.getURL('').slice(0, -1));
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  panel?.querySelector('iframe')?.contentWindow?.postMessage({ type: 'REPOCONTRACT_THEME', theme: theme() }, chrome.runtime.getURL('').slice(0, -1));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'STATUS') { respond({ ok: true, phase: state.phase, error: state.error, context: state.context, candidate: Boolean(blobLocation(window.location.href)) }); return; }
  if (message.type === 'SHOW_API') { respond(setView('api')); return; }
  if (message.type === 'OPEN_TAB') { openTab().then(respond); return true; }
  if (message.type === 'RETRY') { scan(true).then(() => respond({ ok: true })); return true; }
});
scan();
