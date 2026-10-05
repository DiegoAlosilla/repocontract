import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContract, MAX_BYTES } from '../src/contract.js';
import { blobLocation, validateContext, fetchGithubFile, readGithubPage } from '../src/github.js';

const yaml = readFileSync(new URL('./fixtures/openapi.yaml', import.meta.url), 'utf8');
const base = parseContract(yaml, 'api.yaml').spec;
const sha = 'a'.repeat(40);
const context = { owner: 'acme', repo: 'pets', ref: 'feature/api', path: 'specs/my api.yaml', sha };

test('YAML/JSON OpenAPI 3.0 y 3.1 y Swagger 2.0', () => {
  assert.equal(parseContract(yaml, 'api.yml').version, '3.0.4');
  assert.equal(parseContract(JSON.stringify(base), 'api.json').detected, true);
  assert.equal(parseContract(JSON.stringify({ ...base, openapi: '3.1.2' }), 'api.json').version, '3.1.2');
  assert.equal(parseContract('swagger: "2.0"\ninfo: {title: Test, version: "1"}\npaths: {}', 'api.yml').version, '2.0');
});
test('YAML común, JSON común y texto que menciona openapi no activan el visor', () => {
  for (const text of ['services:\n  api: {image: nginx}', '{"name":"package"}', 'note: openapi: reference']) assert.equal(parseContract(text).detected, false);
});
test('Errores de sintaxis, claves duplicadas, versiones e incompletos', () => {
  assert.throws(() => parseContract('openapi: [', 'api.yaml'), /interpretar YAML/);
  assert.throws(() => parseContract('{"openapi":', 'api.json'), /interpretar JSON/);
  assert.throws(() => parseContract('openapi: 3.0.4\nopenapi: 3.1.0'), /interpretar YAML/);
  assert.throws(() => parseContract(JSON.stringify({ ...base, openapi: '3.2.0' })), /fuera del alcance/);
  assert.throws(() => parseContract('openapi: 3.1.0\ninfo: {}'), /incompleto/);
  assert.throws(() => parseContract(JSON.stringify({ ...base, paths: { '/pets': { get: {} } } })), /responses/);
});
test('Referencias internas válidas y recursivas; externas y rotas rechazadas', () => {
  const spec = structuredClone(base);
  spec.components.schemas.Pet.properties.friend = { $ref: '#/components/schemas/Pet' };
  assert.equal(parseContract(JSON.stringify(spec)).detected, true);
  spec.components.schemas.Pet.properties.friend.$ref = '#/missing';
  assert.throws(() => parseContract(JSON.stringify(spec)), /inexistente/);
  spec.components.schemas.Pet.properties.friend.$ref = 'https://never-call.example/schema';
  assert.throws(() => parseContract(JSON.stringify(spec)), /referencias externas/);
});
test('JSON Pointer con claves escapadas y referencias porcentuales', () => {
  const spec = structuredClone(base);
  spec.components.schemas['a/b~c'] = { type: 'string' };
  spec.components.schemas.Pet.properties.extra = { $ref: '#/components/schemas/a~1b~0c' };
  assert.equal(parseContract(JSON.stringify(spec)).detected, true);
});
test('Archivos grandes, Git LFS y expansión abusiva de alias', () => {
  assert.throws(() => parseContract(' '.repeat(MAX_BYTES + 1)), /2 MiB/);
  assert.throws(() => parseContract('version https://git-lfs.github.com/spec/v1'), /Git LFS/);
  assert.throws(() => parseContract('openapi: 3.0.0\ninfo: {title: Test, version: "1"}\npaths: {}\nx-loop: &loop [*loop]'), /alias/);
});
test('Contexto: rama con slash, ruta con espacios, SHA e intento de otro repositorio', () => {
  const url = 'https://github.com/acme/pets/blob/feature/api/specs/my%20api.yaml';
  assert.equal(validateContext(context, url).sha, sha);
  assert.equal(validateContext(context, `https://github.com/acme/pets/blob/${sha}/specs/my%20api.yaml`).sha, sha);
  assert.throws(() => validateContext(context, 'https://github.com/other/pets/blob/main/api.yaml'), /seguridad/);
  assert.equal(blobLocation('https://github.com/acme/pets/tree/main'), null);
  assert.equal(blobLocation('https://github.com.evil.test/acme/pets/blob/main/api.yaml'), null);
});
function githubPage(source = yaml, { ref = context.ref, modern = true, flags = {}, lines = source.split('\n') } = {}) {
  const blob = { truncated: false, large: false, viewable: true, headerInfo: { lineInfo: { truncatedLoc: String(lines.length) } }, ...flags };
  const route = { path: context.path, refInfo: { name: ref, currentOid: sha } };
  const payload = modern ? { codeViewLayoutRoute: route, codeViewBlobLayoutRoute: { ...route, blob }, 'codeViewBlobLayoutRoute.StyledBlob': { rawLines: lines } } : { ...route, blob: { ...blob, rawLines: lines } };
  return `<html><script type="application/json">${JSON.stringify({ payload }).replaceAll('<', '\\u003c')}</script></html>`;
}
const pageUrl = 'https://github.com/acme/pets/blob/feature/api/specs/my%20api.yaml';
test('Lee datos completos de GitHub actual y del formato anterior, sin usar filas HTML', () => {
  for (const modern of [true, false]) assert.equal(readGithubPage(githubPage(yaml, { modern }), pageUrl).source, yaml);
  assert.throws(() => readGithubPage(`<pre>${yaml}</pre>`, pageUrl), /acceso actual/);
});
test('Rechaza archivo truncado, ausencia de confirmación, líneas incompletas y LFS', () => {
  for (const flags of [{ truncated: true }, { truncated: undefined }, { large: true }, { viewable: false }]) {
    assert.throws(() => readGithubPage(githubPage(yaml, { flags }), pageUrl), /no renderiza fragmentos/);
  }
  assert.throws(() => readGithubPage(githubPage(yaml, { flags: { headerInfo: { lineInfo: { truncatedLoc: '999' } } } }), pageUrl), /líneas/);
  assert.throws(() => readGithubPage(githubPage(yaml, { flags: { headerInfo: { isGitLfs: true } } }), pageUrl), /Git LFS/);
  assert.throws(() => readGithubPage(githubPage(yaml, { lines: [null] }), pageUrl), /fragmentos/);
});
test('Lectura de la página por SHA con sesión ordinaria, solo GET y sin API', async () => {
  const file = await fetchGithubFile(pageUrl, async (url, options) => {
    assert.equal(url, `https://github.com/acme/pets/blob/${sha}/specs/my%20api.yaml`);
    assert.equal(options.redirect, 'error'); assert.equal(options.method, undefined);
    assert.deepEqual(options.headers, { Accept: 'text/html' });
    assert.equal(Object.hasOwn(options, 'credentials'), false);
    return new Response(githubPage(yaml, { ref: sha }));
  }, context);
  assert.equal(file.source, yaml);
  assert.equal(file.context.ref, 'feature/api');
});
test('Sin contexto fresco, obtiene ruta y contenido de la página actual', async () => {
  const file = await fetchGithubFile(pageUrl, async url => { assert.equal(url, pageUrl); return new Response(githubPage()); });
  assert.equal(file.context.sha, sha);
  assert.equal(file.source, yaml);
});
test('Errores de acceso y de red no solicitan mayor acceso', async () => {
  for (const status of [401, 403, 404, 429, 500]) await assert.rejects(fetchGithubFile(pageUrl, async () => new Response('', { status })), /acceso actual/);
  await assert.rejects(fetchGithubFile(pageUrl, async () => { throw new Error('offline'); }), /puedes abrirlo/);
  await assert.rejects(fetchGithubFile(pageUrl, async () => new Response('<html>Sign in</html>')), /acceso actual/);
  await assert.rejects(fetchGithubFile('https://evil.test/acme/pets/blob/main/api.yaml'), /github.com/);
});
test('Límites del documento y de la página, incluso sin Content-Length', async () => {
  assert.throws(() => readGithubPage(githubPage('x'.repeat(MAX_BYTES + 1)), pageUrl), /2 MiB/);
  const maxPage = 16 * 1024 * 1024;
  await assert.rejects(fetchGithubFile(pageUrl, async () => new Response('x', { headers: { 'content-length': String(maxPage + 1) } })), /16 MiB/);
  await assert.rejects(fetchGithubFile(pageUrl, async () => new Response('x'.repeat(maxPage + 1))), /16 MiB/);
});
