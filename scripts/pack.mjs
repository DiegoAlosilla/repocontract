import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkSigningKey, crxId } from './identity.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  if (!['--key', '--chrome'].includes(flag) || !process.argv[i + 1]) {
    throw new Error('Uso: npm run pack -- [--key ruta.pem] [--chrome ruta/chrome.exe]');
  }
  options[flag] = process.argv[i + 1];
}
const keyFile = path.resolve(options['--key'] ?? process.env.REPOCONTRACT_SIGNING_KEY ?? path.join(root, 'dist.pem'));
let privateKey;
try { privateKey = await readFile(keyFile); }
catch { throw new Error('Falta la clave de firma original. Usa --key ruta.pem. No se generará otra clave ni otro ID.'); }
const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
const expectedId = checkSigningKey(privateKey, manifest);
privateKey = null;
const candidates = [options['--chrome'] ?? process.env.CHROME_PATH,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
  process.platform === 'linux' ? '/usr/bin/google-chrome' : null].filter(Boolean);
let chromePath;
for (const candidate of candidates) {
  try { await access(candidate); chromePath = candidate; break; } catch { /* Try next location. */ }
}
if (!chromePath) throw new Error('No se encontró Chrome. Indica --chrome ruta/chrome.exe.');

await import('./build.mjs');
// Stage the package so a failed Chrome command cannot replace the previous CRX.
const staging = await mkdtemp(path.join(root, '.pack-'));
try {
  const folder = path.join(staging, 'extension');
  await cp(path.join(root, 'dist'), folder, { recursive: true });
  const packed = spawnSync(chromePath, [
    `--pack-extension=${folder}`, `--pack-extension-key=${keyFile}`,
    '--no-message-box', `--user-data-dir=${path.join(staging, 'profile')}`
  ], { windowsHide: true, timeout: 60000, encoding: 'utf8' });
  if (packed.error || packed.status !== 0) {
    throw new Error(`Chrome no pudo empaquetar: ${packed.error?.message ?? packed.stderr.trim() ?? packed.status}`);
  }
  const packagePath = path.join(staging, 'extension.crx');
  const actualId = crxId(await readFile(packagePath));
  if (actualId !== expectedId) throw new Error('El ID del paquete no coincide con la identidad de RepoContract.');
  await cp(packagePath, path.join(root, 'dist.crx'));
  console.log(`Paquete: ${path.join(root, 'dist.crx')}\nVersión: ${manifest.version}\nID fijo: ${actualId}`);
} finally {
  // Verify the absolute target remains a staging folder directly under this repo.
  if (path.dirname(staging) !== root || !path.basename(staging).startsWith('.pack-')) throw new Error('Ruta temporal inesperada.');
  await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
