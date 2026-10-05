import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContract, MAX_BYTES } from '../src/contract.js';
import { blobLocation, validateContext, fetchSource } from '../src/github.js';

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
test('Lectura completa por SHA sin cookies ni autorización en públicos', async () => {
  const text = await fetchSource(context, undefined, async (url, options) => {
    assert.match(url, new RegExp(`contents/specs/my%20api.yaml\\?ref=${sha}$`));
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
    return new Response(yaml);
  });
  assert.equal(text, yaml);
});
test('Privados: token explícito y errores 401/403/404/límite', async () => {
  await fetchSource(context, 'test-token', async (_, options) => { assert.equal(options.headers.Authorization, 'Bearer test-token'); return new Response(yaml); });
  for (const [status, match] of [[401, /caducado/], [403, /SSO/], [404, /privados/], [500, /500/]]) {
    await assert.rejects(fetchSource(context, null, async () => new Response('', { status })), match);
  }
  await assert.rejects(fetchSource(context, null, async () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })), /límite/);
});
test('Corta descargas superiores a 2 MiB, incluso sin Content-Length', async () => {
  await assert.rejects(fetchSource(context, null, async () => new Response('x', { headers: { 'content-length': String(MAX_BYTES + 1) } })), /2 MiB/);
  await assert.rejects(fetchSource(context, null, async () => new Response('x'.repeat(MAX_BYTES + 1))), /2 MiB/);
});
