import { test, expect } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { allowServer, contentType, insideRoot, serverConfigUrl } = await import(
  pathToFileURL(path.resolve('desktop/serve.mjs')).href
);

test('앱은 게임 폴더 밖의 파일을 내주지 않는다', () => {
  const root = path.resolve('dist-workshop');
  expect(insideRoot(root, path.join(root, 'index.html'))).toBe(true);
  expect(insideRoot(root, path.join(root, 'assets/game.js'))).toBe(true);
  expect(insideRoot(root, path.join(root, '../package.json'))).toBe(false);
  expect(insideRoot(root, path.join(root, '..', 'dist-workshop-evil', 'x'))).toBe(false);
  expect(insideRoot(root, root)).toBe(false);
});

test('스테이지 목록과 제작소 API만 앱 출처 처리를 받는다', () => {
  expect(allowServer('https://ip-sasa-workshop.onrender.com/api/stages')).toBe(true);
  expect(allowServer('https://example.org/api/workshop/stages/abc?release=draft')).toBe(true);
  expect(allowServer('http://127.0.0.1:5180/api/workshop/stages')).toBe(true);
  expect(allowServer('https://example.org/api/other')).toBe(false);
  expect(allowServer('https://example.org/login')).toBe(false);
  expect(allowServer('file:///api/stages')).toBe(false);
  expect(allowServer('not a url')).toBe(false);
});

test('서버 주소 설정은 http(s)만 받고 끝 슬래시를 뗀다', () => {
  expect(serverConfigUrl('{"url":"https://a.example/"}')).toBe('https://a.example');
  expect(serverConfigUrl('{"url":"javascript:alert(1)"}')).toBe('');
  expect(serverConfigUrl('{"url":""}')).toBe('');
  expect(serverConfigUrl('broken')).toBe('');
});

test('파일 종류에 맞는 형식으로 내준다', () => {
  expect(contentType('a/index.html')).toContain('text/html');
  expect(contentType('a/game.JS')).toContain('javascript');
  expect(contentType('a/rocket.png')).toBe('image/png');
  expect(contentType('a/unknown.bin')).toBe('application/octet-stream');
});
