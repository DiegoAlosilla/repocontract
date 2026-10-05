# Verificación

Comprobaciones realizadas el **4 de octubre de 2026**, America/Lima. Entorno: Windows, Node.js 24.18.0, Playwright 1.63.0, Chromium/Chrome for Testing 153.0.8010.12. La extensión se cargó desempaquetada en perfiles aislados, con Manifest V3 y CSP reales.

## Resultado automatizado

`npm run check`: **10 pruebas unitarias y 9 pruebas de integración aprobadas**.

| Área | Comprobado | Entorno |
|---|---|---|
| Detección | Swagger 2.0, OpenAPI 3.0.4/3.1.2; YAML/YML y JSON; configuración común no activa controles | Parser y extensión real con fixtures |
| Errores | Sintaxis rota, claves duplicadas, versión fuera de alcance, info/respuestas incompletas, referencias rotas/externas, LFS y exceso de tamaño | Unitarias y aviso en navegador |
| Contenido completo | La API entrega el contrato completo aunque el HTML solo tenga una línea visible | Transporte simulado, parser y visor reales |
| Renderizado | Endpoints, parámetros, request body, respuestas y modelos; referencias internas y modelos de Swagger/OpenAPI | Swagger UI 5.33.1 real, incluido localmente |
| Alternancia | API oculta el código y su capa de textarea; Código lo restaura; reabrir mantiene un solo iframe | Extensión real |
| Nueva pestaña | Mismo documento; enlace y contexto fijados al commit SHA | Mensajería y pestañas reales |
| Popup | Sus botones envían las acciones a la pestaña activa: integrar y abrir otra pestaña | Popup cargado como página de extensión; pestaña GitHub simulada |
| Navegación | Cambio de archivo SPA, rama con slash, eliminación de visor, ausencia de botones duplicados y descarte de respuestas tardías | URL/DOM de GitHub simulados, content script real |
| Tema | Cambio claro→oscuro de GitHub comunicado al iframe | Fixture y capturas en GitHub real |
| Solo lectura | Sin Try it out ni Authorize; ninguna solicitud a endpoints del contrato o al validador durante las interacciones comprobadas | CSP/interceptor reales y observación de solicitudes |
| Privados | 404 sin token, Bearer explícito, `credentials: omit`, recuperación y borrado de token de sesión | API simulada; popup, worker y almacenamiento reales |

Las pruebas de integración reemplazan **únicamente el HTML de GitHub y el transporte fetch del service worker**. No se sustituyen el renderer, el parser, los permisos, la CSP, el aislamiento, las APIs de Chrome, las pestañas ni la lógica de navegación. Esto permite verificar casos de error y privados sin credenciales reales. No demuestra acceso real a un repositorio privado.

## Comprobación pública real

Se ejecutó `npm run test:live` contra [Swagger Petstore](https://github.com/swagger-api/swagger-petstore/blob/master/src/main/resources/openapi.yaml), sin mocks de HTML ni de red. Se comprobó:

- Aparición de Ver API en el DOM vigente de GitHub.
- Lectura de Contents sin token usando el commit `d57941e8fe959e508796b27469b1e8bba73392dc`.
- Renderizado de **19 operaciones**, OpenAPI 3.0.4, y expansión de una operación con request body.
- Regreso al código y reapertura del visor.
- Apertura del mismo contrato en otra pestaña y permalink por SHA.
- Navegación con el árbol real de GitHub a `inflector.yaml`: descarga y detección final como documento ajeno a OpenAPI (`phase: unrelated`), sin visor ni controles restantes.
- Capturas con tema claro y oscuro; ninguna petición observada al servidor Petstore ni al validador, y ningún error JavaScript de página.

Esta comprobación permitió corregir diferencias que los fixtures iniciales no reproducían: los metadatos actuales en `codeViewLayoutRoute`, el contenedor virtualizado con un textarea transparente y el JSON inicial obsoleto tras navegar por React. Se añadieron regresiones para ocultar todas las capas del código y recuperar el contexto fresco cuando el JSON inicial ya no coincide con la URL.

## Pendiente

- Autenticación **real** de un repositorio privado con un token proporcionado por su propietario, incluyendo aprobación de organización/SSO. El mecanismo y los pasos están en el README; no se asumió que las cookies autentican REST.
- Prueba manual del icono fijado y su ventana nativa en Chrome estable con un perfil habitual. Se probaron las acciones y la lógica de su popup como página de extensión, sin automatizar el clic físico de la barra de Chrome.
- Validación en Chrome 116 (mínimo declarado); lo ejecutado aquí fue Chromium 153.
- Otros diseños/experimentos A/B de GitHub y casos completos de JSON Schema 3.1. La validación local es estructural; no se declara conformidad exhaustiva con cada keyword de la especificación.
- Referencias entre archivos, referencias por ancla, LFS, Enterprise, búsqueda de contratos, exportaciones y comparación de versiones quedan fuera de esta versión.

`npm run test:live` genera `test-results/live-report.json` y capturas. Las pruebas E2E limpian `test-results` al iniciar; las evidencias conservadas de esta entrega se encuentran en `docs/verification/`.

- [Informe público real](verification/live-report.json).
- [Captura en tema claro](verification/live-github-light.png).
- [Captura en tema oscuro](verification/live-github-dark.png).
