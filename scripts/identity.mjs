import { createHash, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function extensionId(publicKey) {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
}

export function checkSigningKey(privateKey, manifest) {
  if (!manifest.key) throw new Error('El manifest no tiene una identidad pública fijada.');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (!publicKey.equals(Buffer.from(manifest.key, 'base64'))) {
    throw new Error('La clave de firma no corresponde a RepoContract. Se canceló para evitar generar otro ID.');
  }
  return extensionId(publicKey);
}

export function crxId(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'Cr24' || bytes.readUInt32LE(4) !== 3) {
    throw new Error('Chrome no generó un paquete CRX3 válido.');
  }
  const headerLength = bytes.readUInt32LE(8);
  if (headerLength > 16 * 1024 * 1024 || 12 + headerLength > bytes.length) throw new Error('Cabecera CRX3 incompleta.');
  function fields(buf) {
    let offset = 0;
    const result = new Map();
    function varint() {
      let value = 0;
      for (let shift = 0; shift <= 28; shift += 7) {
        if (offset >= buf.length) throw new Error('Cabecera CRX3 incompleta.');
        const byte = buf[offset++];
        value += (byte & 127) * 2 ** shift;
        if (!(byte & 128)) return value;
      }
      throw new Error('Cabecera CRX3 inválida.');
    }
    while (offset < buf.length) {
      const tag = varint();
      if ((tag & 7) !== 2) throw new Error('Campo CRX3 inesperado.');
      const length = varint();
      if (offset + length > buf.length) throw new Error('Campo CRX3 incompleto.');
      result.set(Math.floor(tag / 8), buf.subarray(offset, offset + length));
      offset += length;
    }
    return result;
  }
  const signedHeader = fields(bytes.subarray(12, 12 + headerLength)).get(10000);
  if (!signedHeader) throw new Error('El paquete no contiene identidad firmada.');
  const id = fields(signedHeader).get(1);
  if (id?.length !== 16) throw new Error('El paquete no contiene un ID válido.');
  return id.toString('hex').replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  if (!manifest.key) throw new Error('No hay una identidad pública fijada.');
  console.log(extensionId(Buffer.from(manifest.key, 'base64')));
}
