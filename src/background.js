import { parseContract } from './contract.js';
import { validateContext, fetchSource } from './github.js';

const trusted = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
const documentKey = id => `document:${id}`;
let writes = Promise.resolve();

async function remember(document, expectedToken) {
  // Serialize pruning so simultaneous GitHub tabs cannot evict each other's writes.
  const id = crypto.randomUUID();
  writes = writes.catch(() => {}).then(async () => {
    const all = await chrome.storage.session.get(null);
    if (all.githubToken !== expectedToken) throw new Error('Las credenciales cambiaron durante la lectura. Vuelve a comprobar el archivo.');
    const entries = Object.entries(all).filter(([key]) => key.startsWith('document:')).sort((a, b) => a[1].created - b[1].created);
    let bytes = entries.reduce((sum, [, value]) => sum + JSON.stringify(value).length * 2, 0);
    const size = JSON.stringify(document).length * 2;
    if (size > 6 * 1024 * 1024) throw new Error('El documento procesado supera la memoria disponible del visor. Reduce el tamaño del contrato.');
    while (entries.length && (bytes + size > 6 * 1024 * 1024 || entries.length >= 8)) {
      const [key, value] = entries.shift();
      await chrome.storage.session.remove(key);
      bytes -= JSON.stringify(value).length * 2;
    }
    await chrome.storage.session.set({ [documentKey(id)]: { ...document, created: Date.now() } });
  });
  await writes;
  return id;
}

async function handle(message, sender) {
  if (message.type === 'READ_CONTRACT') {
    if (sender.frameId !== 0 || !sender.tab || !sender.url?.startsWith('https://github.com/')) throw new Error('Origen no autorizado.');
    // sender.url can retain the injection URL after GitHub pushState navigation.
    // The tab's current URL is authoritative; host permission exposes it without
    // asking for the broad "tabs" permission.
    const currentTab = await chrome.tabs.get(sender.tab.id);
    const context = validateContext(message.context, currentTab.url);
    const { githubToken } = await chrome.storage.session.get('githubToken');
    const source = await fetchSource(context, githubToken);
    const result = parseContract(source, context.path);
    if (!result.detected) return { detected: false };
    const id = await remember({ context, spec: result.spec, version: result.version, sourceTab: sender.tab.id }, githubToken);
    return { detected: true, id, context, version: result.version };
  }
  if (message.type === 'GET_DOCUMENT') {
    if (!trusted(sender) || !sender.url.startsWith(chrome.runtime.getURL('viewer.html'))) throw new Error('Origen no autorizado.');
    if (!/^[a-f0-9-]{36}$/.test(message.id ?? '')) throw new Error('Visor inválido.');
    const value = (await chrome.storage.session.get(documentKey(message.id)))[documentKey(message.id)];
    if (!value) throw new Error('La sesión del visor caducó. Vuelve al archivo en GitHub y pulsa Ver API.');
    if (sender.frameId !== 0 && sender.tab?.id !== value.sourceTab) throw new Error('Este visor pertenece a otro archivo.');
    return value;
  }
  if (message.type === 'OPEN_DOCUMENT') {
    const value = (await chrome.storage.session.get(documentKey(message.id)))[documentKey(message.id)];
    if (!value || (!trusted(sender) && sender.tab?.id !== value.sourceTab)) throw new Error('Vuelve a abrir el contrato desde GitHub.');
    await chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?id=${message.id}&theme=${message.theme === 'dark' ? 'dark' : 'light'}`) });
    return {};
  }
  if (message.type === 'SET_TOKEN') {
    if (!trusted(sender) || !sender.url.startsWith(chrome.runtime.getURL('popup.html'))) throw new Error('Origen no autorizado.');
    const token = String(message.token ?? '').trim();
    if (token && !/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new Error('El token no tiene un formato válido.');
    writes = writes.catch(() => {}).then(async () => {
      if (token) await chrome.storage.session.set({ githubToken: token });
      else await chrome.storage.session.remove('githubToken');
      // Forget cached private documents when credentials change.
      const all = await chrome.storage.session.get(null);
      await chrome.storage.session.remove(Object.keys(all).filter(key => key.startsWith('document:')));
    });
    await writes;
    return { configured: Boolean(token) };
  }
  if (message.type === 'TOKEN_STATUS' && trusted(sender)) {
    return { configured: Boolean((await chrome.storage.session.get('githubToken')).githubToken) };
  }
  throw new Error('Operación no permitida.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(data => respond({ ok: true, ...data })).catch(error => {
    respond({ ok: false, error: error.message || 'No se pudo procesar el contrato.', code: error.code ?? 'UNKNOWN' });
  });
  return true;
});
