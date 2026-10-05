const params = new URLSearchParams(location.search);
const status = document.getElementById('status');
const applyTheme = value => { document.documentElement.dataset.theme = value === 'dark' ? 'dark' : 'light'; };
applyTheme(params.get('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.getElementById('theme').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
window.addEventListener('message', event => {
  if (event.source === parent && event.origin === 'https://github.com' && event.data?.type === 'REPOCONTRACT_THEME') applyTheme(event.data.theme);
});

async function render() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_DOCUMENT', id: params.get('id') });
  if (!result.ok) throw new Error(result.error);
  const { context, spec, version } = result;
  const source = document.getElementById('source');
  source.textContent = `${context.owner}/${context.repo} · ${context.path} ↗`;
  source.href = `https://github.com/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/blob/${context.sha}/${context.path.split('/').map(encodeURIComponent).join('/')}`;
  document.getElementById('revision').textContent = `${context.ref} · ${context.sha.slice(0, 12)} · ${version === '2.0' ? 'Swagger' : 'OpenAPI'} ${version}`;
  document.title = `${spec.info.title} · RepoContract`;
  const readOnly = () => ({
    components: { AuthorizeBtn: () => null, auths: () => null },
    statePlugins: { spec: { wrapActions: { executeRequest: () => () => { throw new Error('RepoContract funciona en modo de solo lectura.'); } } } }
  });
  window.SwaggerUIBundle({
    spec, dom_id: '#swagger-ui', layout: 'BaseLayout',
    supportedSubmitMethods: [], tryItOutEnabled: false, validatorUrl: null,
    queryConfigEnabled: false, persistAuthorization: false,
    requestInterceptor: () => { throw new Error('Las peticiones de red están deshabilitadas en RepoContract.'); },
    plugins: [readOnly], deepLinking: false, docExpansion: 'list',
    filter: true, defaultModelsExpandDepth: 1, displayOperationId: true,
    onComplete: () => { status.hidden = true; }
  });
}
render().catch(error => { status.textContent = error.message; status.className = 'error'; status.setAttribute('role', 'alert'); });
