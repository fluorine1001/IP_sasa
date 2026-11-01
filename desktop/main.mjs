// 아폴로 desktop app (Electron main process).
// Opens entirely from files inside the app: no web hosting, no local server, no
// internet needed to start or play. The stage workshop talks to the shared
// server whenever there is a connection, through Chromium's own network stack,
// so it follows the computer's proxy/PAC settings, VPN routes and installed
// certificates (school and company networks included).
import { app, BrowserWindow, Menu, net, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowServer, contentType, insideRoot, serverConfigUrl } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.join(here, '..', 'dist-workshop');
const ORIGIN = 'app://apollo';

// Saves (progress, settings, workshop drafts) live in the app's own profile folder,
// e.g. %APPDATA%\Apollo on Windows. The name stays fixed so updates keep the saves.
app.setName('아폴로');
app.setPath('userData', path.join(app.getPath('appData'), 'Apollo'));
// UDP/QUIC is often blocked or mangled on school and office networks; plain HTTPS is reliable.
app.commandLine.appendSwitch('disable-quic');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

if (!app.requestSingleInstanceLock()) app.quit();

/** The shared server: APOLLO_SERVER overrides the project's server-config.json. */
let sharedServer = '';
async function loadServer() {
  const config = path.join(here, '..', 'src/stages/server-config.json');
  sharedServer =
    serverConfigUrl(JSON.stringify({ url: process.env.APOLLO_SERVER ?? '' })) ||
    serverConfigUrl(await readFile(config, 'utf8').catch(() => '{}'));
}

/**
 * The workshop asks its own origin for /api/... (the key check, and an empty
 * server address). In the app that origin is app://apollo, so those requests go
 * on to the shared server through Chromium's network stack.
 */
async function forward(request, url) {
  if (!sharedServer)
    return Response.json({ error: '공유 서버 주소가 설정되지 않았습니다.' }, { status: 503 });
  const headers = new Headers(request.headers);
  headers.delete('origin');
  headers.delete('host');
  try {
    return await net.fetch(sharedServer + url.pathname + url.search, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      bypassCustomProtocolHandlers: true,
    });
  } catch (error) {
    return Response.json(
      {
        error: '공유 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요. (' + error.message + ')',
      },
      { status: 502 },
    );
  }
}

/** Files of the built game and workshop, served under app://apollo/. */
function serveContent() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz')
      return forward(request, url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/editor') pathname = '/editor.html';
    const file = path.join(content, pathname);
    if (!insideRoot(content, file)) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(file), {
        headers: { 'Content-Type': contentType(file) },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/**
 * The shared server only accepts its own web origin or no origin for workshop
 * writes. The app's pages have the app:// origin, so for the server's API the
 * request leaves without an Origin header (like a tool, not a foreign site) and
 * the answer is marked readable by the app. Nothing changes on the server.
 */
function connectWorkshop() {
  const api = { urls: ['https://*/api/*', 'http://*/api/*'] };
  session.defaultSession.webRequest.onBeforeSendHeaders(api, (details, done) => {
    const headers = { ...details.requestHeaders };
    if (allowServer(details.url))
      for (const key of Object.keys(headers))
        if (key.toLowerCase() === 'origin') delete headers[key];
    done({ requestHeaders: headers });
  });
  session.defaultSession.webRequest.onHeadersReceived(api, (details, done) => {
    if (!allowServer(details.url)) return done({});
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(
        ([key]) => !key.toLowerCase().startsWith('access-control-'),
      ),
    );
    headers['Access-Control-Allow-Origin'] = [ORIGIN];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['Authorization, Content-Type, If-Match'];
    headers['Access-Control-Expose-Headers'] = ['ETag'];
    done({
      responseHeaders: headers,
      // Some proxies answer a CORS pre-check with 405; the real request decides.
      ...(details.method === 'OPTIONS' ? { statusLine: 'HTTP/1.1 204 No Content' } : {}),
    });
  });
}

function open(page = '/') {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#101820',
    title: page.startsWith('/editor') ? '아폴로 · 스테이지 제작소' : '아폴로',
    icon: path.join(here, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  window.loadURL(ORIGIN + page);
  // Other sites open in the normal browser; the app never navigates away from itself.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) {
      open(new URL(url).pathname);
      return { action: 'deny' };
    }
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  return window;
}

function menu() {
  const template = [
    {
      label: '아폴로',
      submenu: [
        { label: '게임 창 열기', accelerator: 'CmdOrCtrl+N', click: () => open('/') },
        {
          label: '스테이지 제작소 열기',
          accelerator: 'CmdOrCtrl+E',
          click: () => open('/editor.html'),
        },
        { type: 'separator' },
        { label: '끝내기', role: 'quit' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '전체 화면', role: 'togglefullscreen' },
        { label: '크게', role: 'zoomIn' },
        { label: '작게', role: 'zoomOut' },
        { label: '원래 크기', role: 'resetZoom' },
        { type: 'separator' },
        { label: '새로 고침', role: 'reload' },
        { label: '개발자 도구', role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  } else open('/');
});
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  await loadServer();
  serveContent();
  connectWorkshop();
  menu();
  open(process.argv.includes('--editor') ? '/editor.html' : '/');
  // The free shared server sleeps when idle; wake it now so the workshop and the
  // latest stage list answer quickly later. Offline, this quietly does nothing.
  if (sharedServer) net.fetch(sharedServer + '/healthz').catch(() => {});
});
