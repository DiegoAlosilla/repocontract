import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const out = path.resolve(root, 'dist');
if (path.dirname(out) !== root || path.basename(out) !== 'dist') throw new Error('Ruta de compilación inesperada.');
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'vendor'), { recursive: true });
await build({ entryPoints: ['src/background.js', 'src/content.js', 'src/viewer.js', 'src/popup.js'], outdir: out, bundle: true, format: 'iife', target: 'chrome116', minify: true, legalComments: 'eof' });
for (const name of await readdir('src')) if (/\.(html|css|json)$/.test(name)) await cp(path.join('src', name), path.join(out, name));
for (const name of ['swagger-ui-bundle.js', 'swagger-ui.css', 'LICENSE', 'NOTICE']) await cp(path.join('node_modules/swagger-ui-dist', name), path.join(out, 'vendor', name));
await cp('node_modules/yaml/LICENSE', path.join(out, 'vendor', 'YAML-LICENSE'));
await writeFile(path.join(out, 'vendor', 'VERSIONS.txt'), 'swagger-ui-dist 5.33.1\nyaml 2.9.1\n');

// Small deterministic PNG icons. No generated artwork or build-time image service.
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([size, t, data, checksum]); };
await mkdir(path.join(out, 'icons'));
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const nx = x / size, ny = y / size;
    const bracket = ((nx > .21 && nx < .3) || (nx > .7 && nx < .79)) && ny > .23 && ny < .77 ||
      ((nx > .21 && nx < .4) || (nx > .6 && nx < .79)) && ((ny > .23 && ny < .31) || (ny > .69 && ny < .77));
    const dot = nx > .45 && nx < .55 && ny > .46 && ny < .56;
    pixels.set(bracket || dot ? [240, 246, 252, 255] : [13, 17, 23, 255], i);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  await writeFile(path.join(out, 'icons', `${size}.png`), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('RepoContract compilado en dist/. Carga esa carpeta en chrome://extensions.');
