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

export async function fetchSource(context, token, fetcher = fetch) {
  const path = context.path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/contents/${path}?ref=${context.sha}`;
  const headers = { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetcher(url, { headers, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch {
    throw new ContractError('No se pudo descargar el archivo completo. Comprueba la conexión e inténtalo otra vez.', 'NETWORK');
  }
  if (!response.ok) {
    if (response.status === 404) throw new ContractError('GitHub no permite leer este archivo o ya no existe. En repositorios privados, configura un token con Contents: read desde el icono de RepoContract.', 'ACCESS');
    if (response.status === 401) throw new ContractError('El token de GitHub no es válido o ha caducado. Actualízalo desde el icono de RepoContract.', 'ACCESS');
    if (response.status === 403 || response.status === 429) {
      const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
      throw new ContractError(exhausted ? 'Se agotó el límite de lecturas de GitHub. Espera o configura un token desde el icono de RepoContract.' : 'GitHub rechazó la lectura. Revisa los permisos del token, la aprobación de la organización y SSO.', 'ACCESS');
    }
    throw new ContractError(`GitHub respondió ${response.status}. No se pudo obtener el contrato.`, 'NETWORK');
  }
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new ContractError('El archivo supera el límite del MVP (2 MiB).', 'SIZE'); }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new ContractError('El archivo supera el límite del MVP (2 MiB).', 'SIZE'); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('La descarga se interrumpió antes de recuperar el archivo completo. Inténtalo otra vez.', 'NETWORK');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ContractError('El archivo no contiene texto UTF-8 válido.', 'ENCODING'); }
}
