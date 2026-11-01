// Pure helpers for the desktop app; kept free of Electron so tests can import them.
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.md': 'text/plain; charset=utf-8',
};
export const contentType = (file) =>
  TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** True when `file` resolves inside `root` (no ../ escapes). */
export function insideRoot(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Only the stage list and workshop API get the app-origin treatment, on any server. */
export function allowServer(url) {
  try {
    const { protocol, pathname } = new URL(url);
    return (
      (protocol === 'https:' || protocol === 'http:') &&
      (pathname === '/api/stages' || pathname.startsWith('/api/workshop/stages'))
    );
  } catch {
    return false;
  }
}

export function serverConfigUrl(text) {
  try {
    const url = JSON.parse(text).url;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url.replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}
