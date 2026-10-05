# RepoContract

Extensión de Chrome Manifest V3 para visualizar el contrato OpenAPI/Swagger del archivo abierto en GitHub. El botón **Ver API** aparece junto a **Raw** después de descargar y reconocer el contrato completo. **Código** restaura el archivo y **Abrir en otra pestaña** conserva el repositorio, la ruta y el commit. El icono de la extensión ofrece las mismas acciones.

## Compilar y cargar

Requisitos: Node.js 22 o posterior, npm y Chrome 116 o posterior. Desde este directorio:

```powershell
npm ci --ignore-scripts
npm run build
```

1. Abre `chrome://extensions` en Chrome.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar desempaquetada** y selecciona `D:\repo-contract\dist` (o la carpeta `dist` de tu copia).
4. Fija RepoContract en la barra de extensiones si quieres usar su icono.
5. Recarga las pestañas de GitHub que estaban abiertas antes de instalar la extensión.

Para actualizar: vuelve a ejecutar `npm run build`, pulsa el botón de recarga de RepoContract en `chrome://extensions` y recarga GitHub. La compilación incluye JavaScript, CSS, parser YAML, Swagger UI, iconos y licencias; no necesita un servidor, un agente de backend ni scripts remotos. `dist/` es el artefacto instalable y se regenera desde las fuentes y el lockfile.

## Prueba rápida en GitHub

Abre [Petstore en GitHub](https://github.com/swagger-api/swagger-petstore/blob/master/src/main/resources/openapi.yaml).

1. Espera el botón **Ver API** junto a Raw. La lectura pública usa GitHub REST sin token.
2. Ábrelo. Despliega una operación y comprueba parámetros, respuestas, ejemplos y modelos. Los cuerpos aparecen en las operaciones que los definen.
3. Pulsa **Código** y vuelve a **Ver API**. Debe conservarse el archivo original y existir un solo visor.
4. Pulsa **Abrir en otra pestaña**. El enlace del visor apunta al mismo archivo fijado al commit SHA.
5. Cambia el tema de GitHub; el visor integrado lo sigue. El visor también tiene un control de tema.
6. Abre otro YAML/JSON mediante los enlaces de GitHub. El visor anterior debe desaparecer; si es configuración común, no debe aparecer Ver API.
7. Pulsa el icono de RepoContract y prueba **Ver API en GitHub**, **Abrir en otra pestaña** y **Volver a comprobar**.

Un documento incompleto muestra el motivo y **Reintentar**, manteniendo disponible el código. Si GitHub no expone la revisión o cambia su estructura, el popup explica que hay que recargar. Los YAML/JSON comunes no activan el visor. Una descarga denegada puede mostrar un aviso incluso en un YAML común porque aún no ha sido posible identificar su contenido.

## Repositorios privados

Se eligió autenticación explícita mediante un **fine-grained personal access token**. Las cookies de la web no se usan para autenticar `api.github.com`. Las solicitudes llevan `credentials: omit`; solo se añade `Authorization: Bearer …` cuando el usuario configura un token.

1. En GitHub, crea un fine-grained token para el propietario y **solo los repositorios necesarios**.
2. Dale **Repository permissions → Contents → Read-only**. RepoContract no necesita permisos de escritura. GitHub incluye acceso de lectura a Metadata según sus reglas.
3. Si la organización lo exige, obtén su aprobación y autoriza el acceso/SSO correspondiente.
4. Abre el icono de RepoContract → **Acceso a repositorios privados** → introduce el token → **Guardar en sesión**.
5. Vuelve al archivo y pulsa **Reintentar** o **Volver a comprobar**. Un 404 puede significar falta de acceso, además de archivo inexistente. Un 401 indica un token inválido; un 403 puede indicar políticas de organización o límite de lecturas.
6. Pulsa **Eliminar token** al terminar. Los documentos cacheados también se eliminan al cambiar el token.

El token y los documentos se guardan en `chrome.storage.session`, en memoria, sin sync/local storage. Se borran al cerrar Chrome o recargar/desactivar la extensión. El content script recibe solo identificadores y contexto, nunca el token. La sesión admite hasta ocho documentos y un presupuesto aproximado de 6 MiB; un visor antiguo puede caducar por rotación del caché. Vuelve a abrirlo desde GitHub cuando ocurra.

**Estado de privados:** se probaron el 404 sin credenciales, el envío de Bearer, la recuperación del visor y la eliminación del token mediante respuestas simuladas de la API dentro de una extensión real. No se recibió un token ni un repositorio privado para comprobar acceso real, SSO o aprobación organizacional. Esa comprobación sigue pendiente; no se declara soporte privado validado en producción.

## Alcance y límites

- Swagger 2.0, OpenAPI 3.0.x y 3.1.x; YAML y JSON. Swagger UI **5.33.1** queda fijado en el lockfile. Su tabla oficial declara compatibilidad con estas familias; se comprobó el renderizado de 2.0, 3.0.4 y 3.1.2 en Chromium.
- `$ref` internos con JSON Pointer (`#/components/schemas/…`, `#/definitions/…`), incluidos modelos recursivos. Las referencias externas, los `$ref` por ancla de JSON Schema (`#Nombre`) y la resolución entre archivos muestran un error explícito. No se descargan referencias externas.
- Límite por archivo: **2 MiB UTF-8**. La descarga se corta por tamaño real, incluso sin Content-Length. Se rechazan punteros Git LFS y alias YAML cíclicos/compartidos; usa `$ref` para reutilizar modelos.
- Validación local de sintaxis, versión, info, rutas, operaciones, respuestas y existencia de referencias. Es una validación estructural del MVP, no un linter exhaustivo de todos los campos de OpenAPI/JSON Schema. Swagger UI puede mostrar errores adicionales de renderizado.
- Solo archivos `/owner/repo/blob/…` en `github.com`. No hay búsqueda desde la raíz, GitHub Enterprise, exportación de cURL/Postman, comparación de versiones ni escrituras en GitHub.
- Swagger UI conserva algunos textos propios en inglés. La integración, los controles y los errores de RepoContract están en español.
- El DOM de GitHub es una integración no contractual: hay selectores de respaldo y comprobación de revisión, pero una modificación futura de GitHub puede requerir actualizar el adaptador.

## Privacidad y permisos

`storage` permite usar almacenamiento de sesión para token y contratos. Acceso a `github.com` permite integrar la vista y comprobar la URL vigente de la pestaña tras navegación SPA. Acceso a `api.github.com` permite recuperar el archivo completo por SHA. No se solicitan `tabs`, `cookies`, `scripting`, `webRequest`, historial ni acceso a todos los sitios.

Los accesos de red de RepoContract son **GET** al endpoint Contents de GitHub para el documento seleccionado y, cuando una navegación SPA conserva metadatos antiguos, un GET de la página actual en `github.com` para recuperar ruta/revisión. Ese respaldo usa la sesión web solo para leer metadatos; Contents mantiene su autenticación independiente. No hay telemetría ni envío a validadores. El visor recibe el objeto ya procesado y tiene `connect-src 'none'` y bloqueo de imágenes remotas. `supportedSubmitMethods: []`, `validatorUrl: null`, un interceptor que rechaza solicitudes y un bloqueo de ejecución impiden probar endpoints u OAuth. Las descripciones pasan por el sanitizador de Swagger UI; nunca se inserta el YAML como HTML. Los enlaces que el usuario abre expresamente pueden navegar al destino indicado.

## Pruebas automatizadas

```powershell
npm test
npx playwright install chromium
npm run test:e2e
```

`npm test` ejecuta pruebas de parser, detección, referencias, contexto, descarga y autenticación. `test:e2e` compila y carga la extensión real en un perfil aislado de Chromium, con HTML y transporte de GitHub simulados para tener casos repetibles. Los scripts de producción no tienen mocks ni modos de prueba. No se necesita abrir un navegador visible.

Para una comprobación pública sin mocks (requiere conexión y está sujeta a cambios de GitHub/rate limits):

```powershell
npm run build
npm run test:live
```

Resultados, alcance de cada prueba y pendientes: [docs/VERIFICATION.md](docs/VERIFICATION.md). Arquitectura y documentación oficial consultada: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
