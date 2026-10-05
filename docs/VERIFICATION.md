# Verificación de 0.2.0

Ejecutada el **5 de octubre de 2026 UTC** (4 de octubre, America/Lima). Windows, Node.js 24.18.0, Playwright 1.63.0 y Chromium 153. Extensión desempaquetada en perfiles aislados, con Manifest V3 y CSP reales.

## Automatizado

`npm run check`: **13 unitarias y 12 de integración aprobadas**. La comprobación adicional de identidad/empaquetado se realizó el 5 de octubre de 2026, America/Lima.

| Área | Comprobado |
|---|---|
| Detección | Swagger 2.0, OpenAPI 3.0.4/3.1.2, YAML/YML y JSON; configuración común no activa controles |
| Errores | Sintaxis, claves duplicadas, versiones, campos incompletos, referencias, LFS y límites |
| Contenido completo | JSON de página aunque HTML visible tenga solo una línea; formatos actual/anterior; rechazo de truncamiento, flags ausentes y líneas discordantes |
| Transporte | GET github.com por SHA; sin Authorization ni REST; errores de acceso/red y límites incrementales |
| Renderizado | Endpoints, parámetros, cuerpos, respuestas y modelos con referencias internas; Swagger UI 5.33.1 real local |
| Alternancia | API oculta código/textarea; Código los restaura; un solo iframe al reabrir |
| Nueva pestaña | Mismo contrato y permalink por SHA |
| Popup | Integración/nueva pestaña sobre pestaña activa; sin formulario de acceso |
| Navegación | SPA, rama con slash, JSON inicial obsoleto, descarte de lecturas tardías y controles sin duplicados |
| Tema | Cambio claro a oscuro comunicado al iframe |
| Solo lectura | Sin Try it out/Authorize; sin solicitudes a endpoint de prueba ni validador |
| Sesión web | Cookie HttpOnly artificial aplicada automáticamente; solo documentos en caché; lectura denegada conserva código sin ampliar acceso |
| Permisos | Solo storage y https://github.com/*; ninguna llamada a api.github.com en E2E |
| Identidad | Dos copias en rutas distintas conservan el ID lcpmdaameifjfcobihelkhohgdfhfdjn en Chromium real |

Las E2E simulan **servidor GitHub y HTML**; content script, worker, parser, renderer, CSP, permisos, APIs Chrome y pestañas son reales. No se reemplaza fetch del worker: ya no hace solicitudes. La cookie artificial vive en el harness, no en la extensión. No demuestra acceso privado real.

El comando `npm run pack` se ejecutó dos veces con la misma clave original: ambos CRX3 conservaron el ID del manifest. Se verificó también que una clave ausente o diferente cancela el empaquetado antes de compilar y conserva el CRX anterior. La clave privada se excluye de Git y del paquete. No se probó instalar el paquete bajo las políticas corporativas.

## GitHub público real

`npm run test:live` aprobado contra [Swagger Petstore](https://github.com/swagger-api/swagger-petstore/blob/master/src/main/resources/openapi.yaml), sin mocks:

- Ver API en DOM vigente y lectura de página del commit `d57941e8fe959e508796b27469b1e8bba73392dc` mediante GET sin Authorization.
- **19 operaciones**, OpenAPI 3.0.4 y expansión de una operación.
- Restauración/reapertura del código y nueva pestaña con el mismo contrato.
- Navegación mediante árbol real a inflector.yaml: `phase: unrelated`, sin controles ni visor restantes.
- Capturas claras/oscuras; sin errores JavaScript ni solicitudes observadas a Petstore/validador.

GitHub hace su propia petición `api.github.com/_private/browser/stats`. El informe conserva su iniciador CDP, `github.githubassets.com/assets/app-runtime-…js`, para distinguirla de RepoContract. No se observó llamada de la extensión a REST. Se corrigió la comprobación inicial que atribuía todas las solicitudes de página a la extensión.

## Pendiente

- **Repositorio privado real** con sesión web abierta, estructura de página y restricciones organización/SSO. Basta abrir archivo y comprobar lectura/renderizado; RepoContract no recibe credenciales.
- Icono y ventana nativa del popup en Chrome estable habitual. Se probaron acciones como página de extensión, sin clic físico en la barra.
- Chrome 116 mínimo declarado; ejecutado Chromium 153.
- Instalación bajo políticas corporativas del usuario: pruebas aisladas sin modificar esas políticas.
- Otros experimentos de DOM/datos de GitHub y conformidad exhaustiva OpenAPI/JSON Schema.

Referencias entre archivos/anclas, LFS, Enterprise, búsqueda, exportación y comparaciones están fuera del alcance.

`test:live` genera test-results; E2E lo limpia al iniciar. Evidencia conservada:

- [Informe público real](verification/live-report.json).
- [Tema claro](verification/live-github-light.png).
- [Tema oscuro](verification/live-github-dark.png).
