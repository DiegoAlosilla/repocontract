import { ContractError, MAX_BYTES } from './contract.js';

export function blobLocation(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (u.origin !== 'https://github.com' || parts[2] !== 'blob' || parts.length < 5 || !/\.(yaml|yml|json)$/i.test(parts.at(-1))) return null;
    return { owner: parts[0], repo: parts[1], tail: parts.slice(3).join('/'), url: `${u.origin}${u.pathname}` };
  } catch { return null; }
}

export function validateContext(context, pageUrl) {
  const location = blobLocation(pageUrl);
  if (!location || !context || context.owner !== location.owner || context.repo !== location.repo ||
      typeof context.path !== 'string' || typeof context.ref !== 'string' || !context.ref ||
      !/^[a-f0-9]{40}$/i.test(context.sha) || !/\.(yaml|yml|json)$/i.test(context.path) ||
      context.path.split('/').some(p => !p || p === '.' || p === '..') ||
      (location.tail !== `${context.ref}/${context.path}` && location.tail !== `${context.sha}/${context.path}`)) {
    throw new ContractError('No se pudo identificar con seguridad el archivo y su revisión. Recarga GitHub e inténtalo otra vez.', 'CONTEXT');
  }
  return { owner: location.owner, repo: location.repo, ref: context.ref, path: context.path, sha: context.sha, url: location.url };
}

export function readGithubPage(html, pageUrl) {
  if (!blobLocation(pageUrl)) throw new ContractError('Abre un archivo YAML o JSON en github.com.', 'CONTEXT');
  let routeFound = false;
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let payload, context, route;
    try {
      payload = JSON.parse(match[1]).payload;
      route = payload?.codeViewLayoutRoute ?? payload?.codeViewBlobRoute ?? payload;
      if (!route?.refInfo || !route.path) continue;
      context = validateContext({ ...blobLocation(pageUrl), path: route.path, ref: route.refInfo.name, sha: route.refInfo.currentOid }, pageUrl);
    } catch { continue; }
    routeFound = true;
    const layout = payload.codeViewBlobLayoutRoute;
    // Support current split routes and the older monolithic GitHub payload.
    const blob = layout?.blob ?? route.blob ?? payload.blob;
    if ((layout?.path && layout.path !== context.path) || (layout?.refInfo?.currentOid && layout.refInfo.currentOid !== context.sha)) {
      throw new ContractError('GitHub entregó datos de otra revisión. Recarga el archivo.', 'CONTEXT');
    }
    if (blob?.headerInfo?.isGitLfs) throw new ContractError('GitHub muestra un puntero Git LFS. El visor necesita el documento completo.', 'LFS');
    const lines = payload['codeViewBlobLayoutRoute.StyledBlob']?.rawLines ?? blob?.rawLines;
    // Explicit completeness is required. Never scrape visible rows or textarea.
    if (!blob || blob.truncated !== false || blob.large === true || blob.viewable === false ||
        !Array.isArray(lines) || !lines.every(line => typeof line === 'string')) {
      throw new ContractError('GitHub no entrega el archivo completo en esta vista: está truncado o no disponible. RepoContract no renderiza fragmentos.', 'INCOMPLETE');
    }
    const loc = String(blob.headerInfo?.lineInfo?.truncatedLoc ?? '');
    if (/^[\d,]+$/.test(loc) && Number(loc.replaceAll(',', '')) !== lines.length) {
      throw new ContractError('El número de líneas recibido no coincide con el archivo. RepoContract no renderiza contenido incompleto.', 'INCOMPLETE');
    }
    const source = lines.join('\n');
    if (new TextEncoder().encode(source).length > MAX_BYTES) throw new ContractError('El archivo supera el límite del MVP (2 MiB).', 'SIZE');
    return { context, source };
  }
  throw new ContractError(routeFound ? 'GitHub no entregó el contenido completo del archivo.' :
    'No se pudo leer el archivo con el acceso actual de la página de GitHub. Comprueba que puedes abrirlo y recarga la página.', 'ACCESS');
}

export async function fetchGithubFile(pageUrl, fetcher = fetch, visibleContext = null) {
  if (!blobLocation(pageUrl)) throw new ContractError('Abre un archivo YAML o JSON en github.com.', 'CONTEXT');
  const context = visibleContext ? validateContext(visibleContext, pageUrl) : null;
  const url = context ? `https://github.com/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/blob/${context.sha}/${context.path.split('/').map(encodeURIComponent).join('/')}` : pageUrl;
  // Runs in the content script under the ordinary same-origin web session.
  // No privileged worker fetch, custom authentication headers or login flow.
  let response;
  try {
    response = await fetcher(url, { headers: { Accept: 'text/html' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  } catch {
    throw new ContractError('No se pudo leer la página del archivo en GitHub. Comprueba que puedes abrirlo y vuelve a intentarlo.', 'NETWORK');
  }
  if (!response.ok) {
    throw new ContractError(`GitHub respondió ${response.status}. El archivo no está disponible con el acceso actual de esta página.`, 'ACCESS');
  }
  // HTML contains syntax styling and route metadata, so its limit is separate.
  const maxPageBytes = 16 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maxPageBytes) { await response.body?.cancel(); throw new ContractError('La página del archivo supera el límite de lectura del visor (16 MiB).', 'SIZE'); }
  if (!response.body) throw new ContractError('GitHub devolvió una página vacía.', 'ACCESS');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxPageBytes) { await reader.cancel(); throw new ContractError('La página del archivo supera el límite de lectura del visor (16 MiB).', 'SIZE'); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('La descarga se interrumpió antes de recuperar el archivo completo. Inténtalo otra vez.', 'NETWORK');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let html;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ContractError('El archivo no contiene texto UTF-8 válido.', 'ENCODING'); }
  const file = readGithubPage(html, url);
  if (context) {
    if (file.context.sha !== context.sha || file.context.path !== context.path) throw new ContractError('La revisión recibida no coincide con el archivo abierto. Recarga GitHub.', 'CONTEXT');
    file.context = context;
  }
  return file;
}
