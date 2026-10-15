import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { blankStage } from '../../src/stages/factory';

let server: Server,
  url = '';
test.beforeAll(async () => {
  await build({ configFile: path.resolve('vite.workshop.config.ts'), logLevel: 'error' });
  const directory = path.resolve('dist-workshop');
  server = createServer(async (req, res) => {
    // An authenticated local fixture, never a request to the real workshop.
    if (req.url === '/api/workshop/stages') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ stages: [] }));
      return;
    }
    const file = path.resolve(directory, '.' + new URL(req.url!, 'http://localhost').pathname);
    if (path.relative(directory, file).startsWith('..')) {
      res.writeHead(404).end();
      return;
    }
    try {
      const data = await readFile(file);
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('test server address');
  url = `http://127.0.0.1:${address.port}/editor.html`;
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
});

test('배포 파일이 사라진 상황에서도 내장 작업자로 탐색과 대표 재생을 실행한다', async ({
  page,
}) => {
  const stage = blankStage();
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 0.4;
  stage.rules.commandLimits = { ignite: 1, stop: 0, turn: 0, separate: 0, push: 0 };
  stage.goals[0].endTime = 0.4;
  stage.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    right: { kind: 'constant', value: 0.05 },
  };
  await page.addInitScript((s) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s));
    localStorage.setItem('orbit-stage-server-v1', JSON.stringify(location.origin));
  }, stage);
  const workers: string[] = [],
    errors: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#search-auto').uncheck();
  // Model an old tab after deployment: no new asset file can be downloaded.
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('성공');
  await page.locator('#search-stop').click();
  await page.locator('[data-family-test]').first().click();
  await expect(page.locator('[data-video-play]')).toBeEnabled();
  expect(workers.some((value) => value.startsWith('blob:'))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/screens/inline-worker-after-deployment.png' });
});
