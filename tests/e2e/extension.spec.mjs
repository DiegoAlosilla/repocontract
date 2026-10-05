import { test, expect, chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseContract } from '../../src/contract.js';

const sha = 'a'.repeat(40);
const yaml = await readFile('tests/fixtures/openapi.yaml', 'utf8');
const v31 = { ...parseContract(yaml).spec, openapi: '3.1.2' };
v31.components.schemas.Pet.properties.age = { type: ['integer', 'null'] };
const swagger = { swagger: '2.0', info: { title: 'Mascotas Swagger 2', version: '1' }, paths: {
  '/pets': { get: { parameters: [{ name: 'limit', in: 'query', type: 'integer' }], responses: { '200': { description: 'Lista de mascotas', schema: { $ref: '#/definitions/Pet' } } } } }
}, definitions: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } };
const sources = { 'api.yaml': yaml, 'other.yml': yaml.replace('Mascotas de prueba', 'Otra API'),
  'config.yaml': 'services:\n  web: {image: nginx}', 'broken.yaml': 'openapi: 3.0.4\ninfo: {}',
  'private.yaml': yaml, 'denied.yaml': yaml, 'truncated.yaml': yaml, 'late.yaml': yaml,
  'v31.json': JSON.stringify(v31), 'swagger.json': JSON.stringify(swagger) };
function githubHtml(file, ref = 'main', partialVisibleCode = false) {
  const lines = (sources[file] ?? '{}').split('\n');
  const route = { path: file, refInfo: { name: ref, currentOid: sha } };
  const payload = { payload: { codeViewLayoutRoute: route,
    codeViewBlobLayoutRoute: { ...route, blob: { truncated: file === 'truncated.yaml', large: false, viewable: true, headerInfo: { lineInfo: { truncatedLoc: String(lines.length) } } } },
    'codeViewBlobLayoutRoute.StyledBlob': { rawLines: lines } } };
  return `<!doctype html><html data-color-mode="light"><head><title>GitHub fixture</title></head><body>
    <main><div class="file-header"><div role="group"><a data-testid="raw-button" href="/acme/pets/raw/${sha}/${file}">Raw</a></div></div>
    <div class="CodeBlob-module__codeBlobWrapper__fixture"><div class="react-code-file-contents"><pre id="code">${partialVisibleCode ? '# Only visible first line' : '# Original code remains available'}</pre></div><textarea aria-label="file content" readonly>Virtualized code layer</textarea></div></main>
    <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script></body></html>`;
}
let context, worker, extensionId, sourceRequests, completedReads, apiRequests;
test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`] });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  sourceRequests = []; completedReads = []; apiRequests = [];
  await context.route('https://api.github.com/**', async route => { apiRequests.push(route.request().url()); await route.fulfill({ status: 403, body: '' }); });
  await context.route('https://github.com/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = pathname.split('/').at(-1);
    const reading = route.request().resourceType() === 'fetch';
    if (reading) sourceRequests.push({ url: route.request().url(), headers: route.request().headers() });
    if (reading && file === 'late.yaml') await new Promise(resolve => setTimeout(resolve, 900));
    if ((reading && file === 'denied.yaml') || (file === 'private.yaml' && !route.request().headers().cookie?.includes('page_access=yes'))) {
      await route.fulfill({ status: 404, body: '' }); return;
    }
    const ref = pathname.includes('feature/api') ? 'feature/api' : pathname.includes(sha) ? sha : 'main';
    await route.fulfill({ contentType: 'text/html', body: githubHtml(file, ref, true) });
    if (reading) completedReads.push(file);
  });
});
test.afterEach(async () => { expect(apiRequests).toEqual([]); await context.close(); });

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
  expect(sourceRequests).toHaveLength(1);
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
  await expect.poll(() => sourceRequests.length).toBe(3);
});

test('respuesta tardía de un archivo anterior no inserta controles obsoletos', async () => {
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/late.yaml');
  await expect.poll(() => sourceRequests.length).toBe(1);
  await page.evaluate(html => {
    history.pushState({}, '', '/acme/pets/blob/main/config.yaml');
    document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
    window.dispatchEvent(new Event('turbo:load'));
  }, githubHtml('config.yaml'));
  await expect.poll(() => sourceRequests.length).toBe(2);
  await expect.poll(() => completedReads.includes('late.yaml')).toBe(true);
  await expect.poll(() => worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter(k => k.startsWith('document:')).length)).toBe(0);
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

test('archivo privado usa automáticamente la sesión web ordinaria sin configuración adicional', async () => {
  // This artificial cookie belongs only to the GitHub test server. Production
  // code neither reads cookies nor sets them; the browser applies its session.
  await context.addCookies([{ name: 'page_access', value: 'yes', domain: 'github.com', path: '/', secure: true, httpOnly: true }]);
  const page = await context.newPage();
  await page.goto('https://github.com/acme/pets/blob/main/private.yaml');
  await expect(page.locator('#repocontract-toggle')).toHaveText('Ver API');
  await page.locator('#repocontract-toggle').click();
  await expect(page.frameLocator('#repocontract-frame').locator('.info .title')).toContainText('Mascotas');
  expect(sourceRequests).toHaveLength(1);
  expect(sourceRequests[0].url).toBe(`https://github.com/acme/pets/blob/${sha}/private.yaml`);
  expect(sourceRequests[0].headers.cookie).toContain('page_access=yes');
  expect(sourceRequests[0].headers.authorization).toBeUndefined();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('input, form, details')).toHaveCount(0);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions).toEqual(['storage']);
  expect(manifest.host_permissions).toEqual(['https://github.com/*']);
  const keys = await worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)));
  expect(keys.length).toBe(1);
  expect(keys.every(key => key.startsWith('document:'))).toBe(true);
});

for (const [file, message] of [['denied.yaml', 'acceso actual'], ['truncated.yaml', 'no entrega el archivo completo']]) {
  test(`rechaza ${file} y conserva el código sin ampliar acceso ni renderizar fragmentos`, async () => {
    const page = await context.newPage();
    await page.goto(`https://github.com/acme/pets/blob/main/${file}`);
    await expect(page.locator('#repocontract-panel')).toContainText(message);
    await expect(page.locator('#repocontract-toggle')).toHaveCount(0);
    await expect(page.locator('#code')).toBeVisible();
    expect(sourceRequests).toHaveLength(1);
    expect(await worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)))).toEqual([]);
  });
}
