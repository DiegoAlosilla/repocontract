const status = document.getElementById('status');
let tab;
async function send(type) {
  if (!tab?.id) throw new Error('Abre un archivo YAML o JSON en github.com.');
  try { return await chrome.tabs.sendMessage(tab.id, { type }); }
  catch { throw new Error('Abre un archivo en github.com y recarga la página después de instalar RepoContract.'); }
}
async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await send('STATUS');
  const ready = result.phase === 'ready';
  document.getElementById('show').disabled = !ready;
  document.getElementById('open').disabled = !ready;
  status.textContent = ready ? `${result.context.owner}/${result.context.repo}\n${result.context.path}` :
    result.error ?? ({ loading: 'Leyendo y validando el archivo completo de la página…', unrelated: 'Este archivo no es un contrato OpenAPI/Swagger.' }[result.phase]) ??
    (result.candidate ? 'Esperando los datos del archivo en GitHub…' : 'Abre un archivo .yaml, .yml o .json en github.com.');
}
const report = error => { status.textContent = error.message; };
document.getElementById('show').addEventListener('click', async () => { try { const result = await send('SHOW_API'); if (!result.ok) throw new Error(result.error); window.close(); } catch (error) { report(error); } });
document.getElementById('open').addEventListener('click', async () => { try { const result = await send('OPEN_TAB'); if (!result.ok) throw new Error(result.error); window.close(); } catch (error) { report(error); } });
document.getElementById('retry').addEventListener('click', async () => { try { await send('RETRY'); await refresh(); } catch (error) { report(error); } });
refresh().catch(report);
setInterval(() => refresh().catch(() => {}), 1000);
