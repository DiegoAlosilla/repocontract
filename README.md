# RepoContract

Extensión Chrome Manifest V3 para visualizar OpenAPI/Swagger del archivo abierto en GitHub. El botón violeta **Ver API** aparece junto a Raw al reconocer un contrato completo. **Código** restaura el archivo; **Abrir en otra pestaña** conserva repositorio, ruta y commit. El icono ofrece las mismas acciones.

## Compilar y cargar

Requisitos: Node.js 22 o posterior, npm y Chrome 116 o posterior.

```powershell
npm ci --ignore-scripts
npm run build
```

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Pulsa **Cargar desempaquetada** y selecciona `D:\repo-contract\dist` (o el `dist` de tu copia).
3. Fija el icono y recarga las pestañas GitHub abiertas.

Para actualizar: compila, recarga RepoContract en `chrome://extensions` y recarga GitHub. La compilación incluye parser YAML, Swagger UI, scripts, CSS, iconos y licencias. No necesita servidor ni agente de backend. `dist/` se regenera desde fuentes y lockfile.

En Chrome administrado, la organización puede impedir cargar extensiones desempaquetadas. La instalación requiere un canal autorizado por el administrador; copiar `dist` a una carpeta de Chrome no instala la extensión. Los paquetes y claves de firma locales se excluyen de Git.

## Prueba rápida

Abre [Petstore en GitHub](https://github.com/swagger-api/swagger-petstore/blob/master/src/main/resources/openapi.yaml).

1. Espera **Ver API** junto a Raw y ábrelo.
2. Despliega operaciones para ver parámetros, cuerpos, respuestas, ejemplos y modelos.
3. Pulsa **Código** y vuelve a **Ver API**: debe conservarse el código original y un único visor.
4. **Abrir en otra pestaña** conserva el mismo documento con enlace por commit SHA.
5. Cambia el tema de GitHub: el visor integrado lo sigue; también tiene control de tema.
6. Navega a otro YAML/JSON mediante GitHub. El visor anterior desaparece; una configuración común no muestra Ver API.
7. Prueba integrar, abrir otra pestaña y volver a comprobar desde el icono.

Un contrato inválido, incompleto o inaccesible muestra un error y **Reintentar**, conservando el código. Una lectura denegada puede mostrar aviso en cualquier archivo candidato porque todavía no se ha identificado su contenido.

## Acceso de la página, incluidos privados

RepoContract 0.2.0 no pide ni administra tokens o credenciales. Lee únicamente la página del archivo abierto en `github.com`, mediante GET del content script. El navegador aplica automáticamente su sesión web habitual. La extensión no lee cookies, no configura cabeceras de autorización y no usa REST ni endpoints internos de autenticación.

Cuando GitHub expone la revisión actual, la lectura se fija a ese SHA. Se extraen las líneas completas del JSON de la página; no se ejecuta el HTML descargado ni se toman las filas visibles como si fueran todo el archivo. Si faltan datos, GitHub marca truncamiento, deniega la lectura o requiere iniciar sesión, se informa del error. No se solicita acceso adicional ni se intenta otra autenticación.

**Privados:** una extensión real comprobó el transporte automático de sesión con un servidor GitHub simulado y una cookie de prueba HttpOnly. También se probó la denegación sin ampliar acceso. Falta comprobar un repositorio privado real, incluyendo restricciones de organización/SSO; no se declara ese escenario validado todavía.

## Alcance y límites

- Swagger 2.0 y OpenAPI 3.0.x/3.1.x; YAML/YML y JSON. Swagger UI **5.33.1** local, con renderizado comprobado de 2.0, 3.0.4 y 3.1.2.
- Referencias internas JSON Pointer, incluidos modelos recursivos. Referencias externas, entre archivos y por ancla (`#Nombre`) muestran error; no se descargan.
- Documento hasta **2 MiB UTF-8** y página hasta **16 MiB**, con límite incremental y timeout. Se rechazan truncamiento, punteros Git LFS y alias YAML cíclicos/compartidos.
- Validación local de sintaxis, versión, info, rutas, operaciones, respuestas y referencias. Es validación estructural del MVP; Swagger UI puede detectar problemas adicionales.
- Solo `/owner/repo/blob/…` en `github.com`. Enterprise, búsqueda desde raíz, exportaciones y comparación quedan para otra etapa.
- Controles/errores en español; Swagger UI conserva algunos textos en inglés.
- DOM/datos de GitHub no son una API estable. Cambios futuros pueden exigir actualizar el adaptador. Sin confirmación de integridad, se rechaza la lectura.

## Privacidad y permisos

Solo `storage` y `https://github.com/*`. Storage de sesión guarda contratos procesados, hasta ocho entradas y aproximadamente 6 MiB. Sin local/sync. La caché se vacía al instalar/actualizar y se pierde al cerrar o recargar la extensión; los visores antiguos pueden caducar por rotación.

Sin permisos `cookies`, `tabs`, `scripting`, `webRequest`, historial u otros hosts. El acceso a GitHub permite integrar y comprobar la URL vigente tras navegar por SPA. Worker y visor tienen `connect-src 'none'`; la lectura ocurre en el content script bajo el origen web de la página.

Procesamiento local, sin escrituras en GitHub, scripts remotos ni telemetría de RepoContract. Swagger UI recibe un objeto procesado y tiene ejecución/validación remota desactivadas, interceptor que rechaza solicitudes y bloqueo de imágenes externas. No se realizan peticiones a endpoints del contrato ni OAuth. Las descripciones pasan por su sanitizador. Los enlaces abiertos expresamente pueden navegar al destino. GitHub conserva sus propias solicitudes de página, independientes de la extensión.

## Verificar

```powershell
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run test:live
```

Unitarias: detección, referencias, contexto, integridad y límites. E2E: extensión real en Chromium aislado con servidor GitHub simulado y sesión artificial; parser y Swagger UI reales. `test:live` usa GitHub público real sin mocks.

Consulta [resultados y pendientes](docs/VERIFICATION.md) y [arquitectura y fuentes oficiales](docs/ARCHITECTURE.md).
