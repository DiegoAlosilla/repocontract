import { test, expect, chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('identidad pública conserva el ID al copiar la extensión a dos rutas distintas', async () => {
  const root = path.resolve('.test-profile');
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(path.join(root, 'identity-'));
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  expect(manifest.key).toBeTruthy();
  try {
    for (const name of ['primera-pc', 'segunda-pc']) {
      const extension = path.join(staging, name);
      await cp(path.resolve('dist'), extension, { recursive: true });
      const browser = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
      try {
        const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
        expect(new URL(worker.url()).host).toBe('lcpmdaameifjfcobihelkhohgdfhfdjn');
        expect(await worker.evaluate(() => chrome.runtime.id)).toBe('lcpmdaameifjfcobihelkhohgdfhfdjn');
      } finally { await browser.close(); }
    }
  } finally {
    if (path.dirname(staging) !== root || !path.basename(staging).startsWith('identity-')) throw new Error('Ruta temporal inesperada.');
    await rm(staging, { recursive: true, force: true });
  }
});
