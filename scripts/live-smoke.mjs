import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const browser = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`] });
const page = await browser.newPage();
const errors = [], forbidden = [];
page.on('pageerror', error => errors.push(error.message));
browser.on('request', req => { if (/validator\.swagger|petstore3?\.swagger|never-call\.example/.test(req.url())) forbidden.push(req.url()); });
const report = { url: 'https://github.com/swagger-api/swagger-petstore/blob/master/src/main/resources/openapi.yaml', testedAt: new Date().toISOString() };
try {
  await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#repocontract-toggle').waitFor({ timeout: 30000 });
  report.button = await page.locator('#repocontract-toggle').textContent();
  await page.locator('#repocontract-toggle').click();
  const frame = page.frameLocator('#repocontract-frame');
  await frame.locator('.info .title').waitFor({ timeout: 30000 });
  report.title = await frame.locator('.info .title').textContent();
  report.operations = await frame.locator('.opblock').count();
  report.revision = await frame.locator('#revision').textContent();
  report.source = await frame.locator('#source').getAttribute('href');
  await frame.locator('.opblock-summary-control').first().click();
  report.expanded = await frame.locator('.opblock-body').count();
  report.tryItOut = await frame.getByRole('button', { name: 'Try it out' }).count();
  await page.frames().find(f => f.url().includes('/viewer.html')).evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/live-github-light.png', fullPage: true });
  await page.evaluate(() => document.documentElement.dataset.colorMode = 'dark');
  await frame.locator('html[data-theme="dark"]').waitFor();
  await page.screenshot({ path: 'test-results/live-github-dark.png', fullPage: true });
  await page.locator('#repocontract-toggle').click();
  report.codeRestored = await page.locator('.react-code-file-contents').isVisible();
  await page.locator('#repocontract-toggle').click();
  const opened = browser.waitForEvent('page');
  await page.getByRole('button', { name: 'Abrir en otra pestaña' }).click();
  const next = await opened;
  await next.locator('.info .title').waitFor();
  report.newTabTitle = await next.locator('.info .title').textContent();
  // Exercise an actual GitHub link to an unrelated YAML, including SPA handling.
  await page.getByText('inflector.yaml', { exact: true }).click();
  await page.waitForURL('**/blob/master/inflector.yaml');
  await page.waitForFunction(() => !document.getElementById('repocontract-panel') && !document.getElementById('repocontract-controls'));
  await page.locator('.react-code-file-contents').waitFor();
  // The content script status confirms recognition has finished, rather than
  // assuming absence of controls immediately after navigation is sufficient.
  const worker = browser.serviceWorkers()[0];
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.endsWith('/inflector.yaml')).id);
  let finalStatus;
  for (let i = 0; i < 50; i++) {
    finalStatus = await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'STATUS' }), tabId);
    if (finalStatus.phase === 'unrelated' || finalStatus.phase === 'error') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  report.navigation = { url: page.url(), phase: finalStatus.phase, noControls: await page.locator('#repocontract-controls').count() === 0, noViewer: await page.locator('#repocontract-frame').count() === 0 };
  report.forbiddenRequests = forbidden;
  report.pageErrors = errors;
  report.ok = report.operations > 0 && report.codeRestored && report.tryItOut === 0 && forbidden.length === 0 && report.navigation.phase === 'unrelated' && report.navigation.noControls && report.navigation.noViewer;
} catch (error) {
  report.ok = false; report.error = error.message;
  report.notice = await page.locator('#repocontract-panel').textContent().catch(() => null);
  report.pageErrors = errors;
  await page.screenshot({ path: 'test-results/live-error.png', fullPage: true });
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/live-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
if (!report.ok) process.exitCode = 1;
