import { parseDocument } from 'yaml';

export const MAX_BYTES = 2 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export class ContractError extends Error {
  constructor(message, code = 'INVALID') { super(message); this.code = code; }
}

// Recognition is separate from validation: a broken OpenAPI document gets a useful
// error; an unrelated YAML document never gets a "Ver API" button.
export function parseContract(source, filename = '') {
  if (new TextEncoder().encode(source).length > MAX_BYTES) {
    throw new ContractError('El archivo supera el límite del MVP (2 MiB).', 'SIZE');
  }
  if (source.startsWith('version https://git-lfs.github.com/spec/')) {
    throw new ContractError('Este archivo es un puntero Git LFS. El MVP necesita el contrato completo.', 'LFS');
  }
  let spec;
  try {
    if (/\.json$/i.test(filename)) spec = JSON.parse(source);
    else {
      const doc = parseDocument(source, { uniqueKeys: true, version: '1.2', strict: true });
      if (doc.errors.length) throw doc.errors[0];
      spec = doc.toJS({ maxAliasCount: 50 });
    }
  } catch (error) {
    const candidate = /(?:^|\n)\s*(?:openapi|swagger)\s*:|"(?:openapi|swagger)"\s*:/.test(source);
    if (!candidate) return { detected: false };
    throw new ContractError(`No se pudo interpretar ${/\.json$/i.test(filename) ? 'JSON' : 'YAML'}: ${error.message.slice(0, 350)}`, 'SYNTAX');
  }
  if (!record(spec) || (!Object.hasOwn(spec, 'openapi') && !Object.hasOwn(spec, 'swagger'))) return { detected: false };
  const version = String(spec.openapi ?? spec.swagger);
  if (version !== '2.0' && !/^3\.(0|1)\.\d+$/.test(version)) {
    throw new ContractError(`Versión ${version} fuera del alcance. Se admite Swagger 2.0 y OpenAPI 3.0/3.1.`, 'VERSION');
  }
  if (Object.hasOwn(spec, 'openapi') && Object.hasOwn(spec, 'swagger')) throw new ContractError('El documento mezcla openapi y swagger. Usa una sola versión.');
  if (!record(spec.info) || typeof spec.info.title !== 'string' || !spec.info.title.trim() || typeof spec.info.version !== 'string') {
    throw new ContractError('Contrato incompleto: info.title e info.version deben ser textos.');
  }
  const is31 = version.startsWith('3.1.');
  if (!record(spec.paths) && !(is31 && (record(spec.webhooks) || record(spec.components)))) {
    throw new ContractError('Contrato incompleto: falta el objeto paths. OpenAPI 3.1 también permite webhooks o components.');
  }
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (path.startsWith('x-')) continue;
    if (!path.startsWith('/') || !record(item)) throw new ContractError(`Ruta inválida: ${path}.`);
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      if (!record(operation) || !record(operation.responses) || !Object.keys(operation.responses).length) {
        throw new ContractError(`Contrato incompleto: ${method.toUpperCase()} ${path} necesita responses.`);
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        if (status.startsWith('x-')) continue;
        if (!record(response) || (!response.$ref && typeof response.description !== 'string')) {
          throw new ContractError(`Respuesta ${status} de ${method.toUpperCase()} ${path}: falta description o $ref.`);
        }
      }
    }
  }
  let nodes = 0;
  const stack = [spec];
  const seen = new WeakSet();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) throw new ContractError('El YAML tiene alias cíclicos o compartidos. Usa referencias $ref internas.');
    seen.add(value);
    if (++nodes > 50000) throw new ContractError('El contrato es demasiado complejo para este MVP.', 'SIZE');
    if (Object.hasOwn(value, '$ref')) {
      const ref = value.$ref;
      if (typeof ref !== 'string' || !(ref === '#' || ref.startsWith('#/'))) {
        throw new ContractError('El MVP admite $ref con JSON Pointer dentro del documento (#/…). Las referencias externas o por ancla quedan para otra etapa.', 'REF');
      }
      let target = spec;
      if (ref !== '#') {
        let pointer;
        try { pointer = decodeURIComponent(ref.slice(2)); } catch { throw new ContractError(`Referencia inválida: ${ref}.`, 'REF'); }
        for (const part of pointer.split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
          if (!target || typeof target !== 'object' || !Object.hasOwn(target, part)) throw new ContractError(`Referencia interna inexistente: ${ref}.`, 'REF');
          target = target[part];
        }
      }
    }
    stack.push(...Object.values(value));
  }
  // Round trip breaks YAML object prototypes and guarantees messaging is JSON safe.
  return { detected: true, version, spec: JSON.parse(JSON.stringify(spec)) };
}
