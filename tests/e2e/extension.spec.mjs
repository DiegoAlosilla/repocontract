import { test, expect, chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseContract } from '../../src/contract.js';

const sha = 'a'.repeat(40);
const yaml = await readFile('tests/fixtures/openapi.yaml', 'utf8');
const base = { owner: 'acme', repo: 'pets', ref: 'main', sha };
const v31 = { ...parseContract(yaml).spec, openapi: '3.1.2' };
v31.components.schemas.Pet.properties.age = { type: ['integer', 'null'] };
const swagger = { swagger: '2.0', info: { title: 'Mascotas Swagger 2', version: '1' }, paths: {
  '/pets': { get: { parameters: [{ name: 'limit', in: 'query', type: 'integer' }], responses: { '200': { description: 'Lista de mascotas', schema: { $ref: '#/definitions/Pet' } } } } }
}, definitions: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } };
function githubHtml(file, ref = 'main', truncated = false) {
  const payload = { payload: { codeViewBlobRoute: { path: file, repo: { name: 'pets', ownerLogin: 'acme' }, refInfo: { name: ref, currentOid: sha } } } };
  return `<!doctype html><html data-color-mode="light"><head><title>GitHub fixture</title></head><body>
    <main><div class="file-header"><div role="group"><a data-testid="raw-button" href="/acme/pets/raw/${sha}/${file}">Raw</a></div></div>
    <div class="CodeBlob-module__codeBlobWrapper__fixture"><div class="react-code-file-contents"><pre id="code">${truncated ? '# Truncated: only visible first line' : '# Original code remains available'}</pre></div><textarea aria-label="file content" readonly>Virtualized code layer</textarea></div></main>
    <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify(payload)}</script></body></html>`;
}
let context, worker, extensionId;
test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`] });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  // Test double only for GitHub's API transport. Real Chrome extension messaging,
  // isolated content script, MV3 CSP, session storage and Swagger UI all run normally.
  await worker.evaluate(({ yaml, v31, swagger }) => {
    globalThis.testRequests = [];
    globalThis.testSources = { 'api.yaml': yaml, 'other.yml': yaml.replace('Mascotas de prueba', 'Otra API'),
      'config.yaml': 'services:\n  web: {image: nginx}', 'broken.yaml': 'openapi: 3.0.4\ninfo: {}',
      'private.yaml': yaml, 'late.yaml': yaml.replace('Mascotas de prueba', 'API obsoleta'), 'v31.json': JSON.stringify(v31), 'swagger.json': JSON.stringify(swagger) };
    globalThis.fetch = async (url, options) => {
      globalThis.testRequests.push({ url: String(url), headers: options.headers, credentials: options.credentials });
      const filename = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
      if (filename === 'late.yaml') await new Promise(r => setTimeout(r, 900));
      if (filename === 'private.yaml' && !options.headers.Authorization) return new Response('', { status: 404 });
      return new Response(globalThis.testSources[filename] ?? '{}');
    };
  }, { yaml, v31, swagger });
  await context.route('https://github.com/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = pathname.split('/').at(-1);
    await route.fulfill({ contentType: 'text/html', body: githubHtml(file, pathname.includes('feature/api') ? 'feature/api' : 'main', true) });
  });
});
test.afterEach(async () => { await context.close(); });

test('detección, contenido completo, renderizado, alternancia, modelo, tema y nueva pestaña', async () => {
  const page = await context.newPage();
  const external = [];
  page.on('request', r => { if (/never-call|validator\.swagger|scarf/.test(r.url())) external.push(r.url()); });
  await page.goto('https://github.com/acme/pets/blob/main/api.yaml');
  await expect(page.locator('#repocontract-toggle')).toHaveText('Ver API');
  await page.locator('#repocontract-toggle').click();
  await expect(page.locator('.react-code-file-contents')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'file content' })).toBeHidden();
  const frame = page.frameLocator('#repocontract-frame');
  await expect(frame.locator('.info .title')).toContainText('Mascotas de prueba');
  await expect(frame.locator('.opblock')).toHaveCount(2);
  await frame.locator('.opblock-get .opblock-summary-control').click();
  await expect(frame.locator('.opblock-get .parameters-container')).toContainText('id');
  await expect(frame.locator('.opblock-get .responses-wrapper')).toContainText('Mascota encontrada');
  await frame.locator('.opblock-post .opblock-summary-control').click();
  await expect(frame.locator('.opblock-post .opblock-body')).toContainText('Request body');
  await expect(frame.locator('section.models')).toContainText('Pet');
  await expect(frame.getByRole('button', { name: 'Try it out' })).toHaveCount(0);
  await expect(frame.getByRole('button', { name: 'Authorize', exact: true })).toHaveCount(0);
  await expect(frame.locator('#revision')).toContainText(sha.slice(0, 12));
  await page.evaluate(() => document.documentElement.dataset.colorMode = 'dark');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/integrated-dark.png', fullPage: true });
  await page.locator('#repocontract-toggle').click();
  await expect(page.locator('.react-code-file-contents')).toBeVisible();
  await expect(page.locator('#repocontract-panel')).toBeHidden();
  await page.locator('#repocontract-toggle').click();
  await expect(page.locator('#repocontract-frame')).toHaveCount(1);
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Abrir en otra pestaña' }).click();
  const newPage = await opened;
  await expect(newPage.locator('.info .title')).toContainText('Mascotas de prueba');
  await expect(newPage.locator('#source')).toHaveAttribute('href', new RegExp(sha));
  expect(external).toEqual([]);
  expect(await worker.evaluate(() => globalThis.testRequests.length)).toBe(1);
});

for (const [file, title, version, count] of [['v31.json', 'Mascotas de prueba', 'OpenAPI 3.1.2', 2], ['swagger.json', 'Mascotas Swagger 2', 'Swagger 2.0', 1]]) {
  test(`renderiza ${version} JSON con referencias internas y modelos`, async () => {
    const page = await context.newPage();
    await page.goto(`https://github.com/acme/pets/blob/main/${file}`);
    await page.locator('#repocontract-toggle').click();
    const frame = page.frameLocator('#repocontract-frame');
    await expect(frame.locator('.info .title')).toContainText(title);
    await expect(frame.locator('#revision')).toContainText(version);
    await expect(frame.locator('.opblock')).toHaveCount(count);
    await expect(frame.locator('section.models')).toContainText('Pet');
    await frame.locator('.opblock-get .opblock-summary-control').click();
    await expect(frame.locator('.opblock-get .responses-wrapper')).toContainText('200');
    await expect(frame.getByRole('button', { name: 'Try it out' })).toHaveCount(0);
  });
}

test('navegación SPA, rama con slash y eliminación del visor anterior', async () => {
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/api.yaml');
  await page.locator('#repocontract-toggle').click();
  await expect(page.frameLocator('#repocontract-frame').locator('.info .title')).toContainText('Mascotas');
  async function navigate(file, ref = 'main') {
    await page.evaluate(({ file, ref, html }) => {
      history.pushState({}, '', `/acme/pets/blob/${ref}/${file}`);
      const next = new DOMParser().parseFromString(html, 'text/html');
      document.body.replaceChildren(...next.body.childNodes);
      window.dispatchEvent(new Event('turbo:load'));
    }, { file, ref, html: githubHtml(file, ref) });
  }
  await navigate('other.yml', 'feature/api');
  await expect(page.locator('#repocontract-toggle')).toHaveText('Ver API');
  await expect(page.locator('#repocontract-frame')).toHaveCount(0);
  await page.locator('#repocontract-toggle').click();
  await expect(page.frameLocator('#repocontract-frame').locator('.info .title')).toContainText('Otra API');
  await page.evaluate(() => { document.body.append(document.createElement('div')); window.dispatchEvent(new Event('turbo:load')); });
  await expect(page.locator('#repocontract-controls')).toHaveCount(1);
  await navigate('config.yaml');
  await expect(page.locator('#repocontract-toggle')).toHaveCount(0);
  await expect(page.locator('#repocontract-frame')).toHaveCount(0);
  await expect.poll(() => worker.evaluate(() => globalThis.testRequests.length)).toBe(3);
});

test('respuesta tardía de un archivo anterior no inserta controles obsoletos', async () => {
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/late.yaml');
  await expect.poll(() => worker.evaluate(() => globalThis.testRequests.length)).toBe(1);
  await page.evaluate(html => {
    history.pushState({}, '', '/acme/pets/blob/main/config.yaml');
    document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
    window.dispatchEvent(new Event('turbo:load'));
  }, githubHtml('config.yaml'));
  await expect.poll(() => worker.evaluate(() => globalThis.testRequests.length)).toBe(2);
  // Wait for the pending read to be processed, then check both document and DOM.
  await expect.poll(() => worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter(k => k.startsWith('document:')).length)).toBe(1);
  await expect(page.locator('#repocontract-controls')).toHaveCount(0);
});

test('SPA realista: embeddedData inicial obsoleto se recupera desde la página actual', async () => {
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/api.yaml');
  await expect(page.locator('#repocontract-toggle')).toHaveText('Ver API');
  await page.locator('#repocontract-toggle').click();
  await page.evaluate(html => {
    history.pushState({}, '', '/acme/pets/blob/main/other.yml');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.querySelector('main').replaceWith(doc.querySelector('main'));
  }, githubHtml('other.yml'));
  await expect(page.locator('#repocontract-toggle')).toHaveText('Ver API');
  await page.locator('#repocontract-toggle').click();
  await expect(page.frameLocator('#repocontract-frame').locator('.info .title')).toContainText('Otra API');
  await expect(page.locator('#repocontract-controls')).toHaveCount(1);
});

test('errores comprensibles para contratos incompletos', async () => {
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/broken.yaml');
  await expect(page.locator('#repocontract-panel')).toContainText('Contrato incompleto');
  await expect(page.locator('#repocontract-toggle')).toHaveCount(0);
  await expect(page.locator('#code')).toBeVisible();
});

test('acciones del popup sobre la pestaña activa: vista integrada y nueva pestaña', async () => {
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/api.yaml');
  await expect(page.locator('#repocontract-toggle')).toHaveText('Ver API');
  let popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await expect(popup.locator('#show')).toBeEnabled();
  await popup.locator('#show').click();
  await expect(page.frameLocator('#repocontract-frame').locator('.info .title')).toContainText('Mascotas');
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await expect(popup.locator('#open')).toBeEnabled();
  const opened = context.waitForEvent('page');
  await popup.locator('#open').click();
  await expect((await opened).locator('.info .title')).toContainText('Mascotas');
});

test('privados: 404 sin token, token en sesión, recuperación y popup alternativo', async () => {
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/private.yaml');
  await expect(page.locator('#repocontract-panel')).toContainText('Contents: read');
  // Open the actual popup page in a tab for testing its controls. Its active GitHub
  // tab is supplied through Chrome messaging, just as with the toolbar popup.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('summary').click();
  await popup.locator('#token').fill('github_pat_' + 'a'.repeat(40));
  await popup.locator('button[type="submit"]').click();
  await expect(popup.locator('#token-status')).toContainText('Token configurado');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.locator('#repocontract-toggle')).toHaveText('Ver API');
  const requests = await worker.evaluate(() => globalThis.testRequests);
  expect(requests[0].headers.Authorization).toBeUndefined();
  expect(requests.at(-1).headers.Authorization).toMatch(/^Bearer github_pat_/);
  expect(requests.at(-1).credentials).toBe('omit');
  // Exercise the popup using the real tab id; no broad tabs permission required.
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const githubTab = tabs.find(t => t.url?.includes('/private.yaml'));
  const status = await popup.evaluate(id => chrome.tabs.sendMessage(id, { type: 'STATUS' }), githubTab.id);
  expect(status.phase).toBe('ready');
  const result = await popup.evaluate(id => chrome.tabs.sendMessage(id, { type: 'SHOW_API' }), githubTab.id);
  expect(result.ok).toBe(true);
  await expect(page.frameLocator('#repocontract-frame').locator('.info .title')).toContainText('Mascotas');
  await popup.locator('#forget').click();
  await expect(popup.locator('#token-status')).toContainText('Sin token');
  expect(await worker.evaluate(async () => (await chrome.storage.session.get('githubToken')).githubToken)).toBeUndefined();
});
