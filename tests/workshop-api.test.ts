import { it, expect } from 'vitest';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workshopApi, type PublicationCheck } from '../scripts/workshop-api';
import { blankStage, emptyStage } from '../src/stages/factory';
import { parseStage } from '../src/stages/validation';
it('공유 API는 공개 목록에서 검증 계획을 숨기고 저장 충돌·복구 가능한 삭제를 처리한다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-workshop-'));
  await mkdir(path.join(root, 'data/stages'), { recursive: true });
  const token = 'test-key-not-a-real-secret-123456',
    handler = workshopApi(
      root,
      parseStage,
      function* () {
        yield {
          done: true,
          errors: [],
          referenceWins: 1,
          simpleWins: [],
          randomWins: 0,
          total: 16,
        };
      },
      token,
    );
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  try {
    const stage = blankStage();
    stage.published = true;
    expect(
      (await fetch(base + '/api/stages', { method: 'POST', headers, body: JSON.stringify(stage) }))
        .status,
    ).toBe(405);
    expect(
      (
        await fetch(base + '/api/workshop/stages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stage),
        })
      ).status,
    ).toBe(403);
    const saved = await fetch(base + '/api/workshop/stages', {
      method: 'POST',
      headers,
      body: JSON.stringify(stage),
    });
    expect(saved.ok).toBe(true);
    const version = await saved.json();
    const listing = await (await fetch(base + '/api/stages')).json();
    expect(listing.stages).toHaveLength(1);
    expect(listing.stages[0].stage.referencePlans).toEqual([]);
    stage.title = 'updated';
    expect(
      (
        await fetch(base + '/api/workshop/stages/' + stage.id, {
          method: 'PUT',
          headers: { ...headers, 'If-Match': 'old' },
          body: JSON.stringify(stage),
        })
      ).status,
    ).toBe(409);
    const update = await (
      await fetch(base + '/api/workshop/stages/' + stage.id, {
        method: 'PUT',
        headers: { ...headers, 'If-Match': version.revision },
        body: JSON.stringify(stage),
      })
    ).json();
    expect(
      JSON.parse(await readFile(path.join(root, 'data/stages', stage.id + '.json'), 'utf8')).title,
    ).toBe('updated');
    expect(
      (
        await fetch(base + '/api/workshop/stages/' + stage.id, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token, 'If-Match': update.revision },
        })
      ).ok,
    ).toBe(true);
    expect((await readdir(path.join(root, '.stage-workshop/trash'))).length).toBe(1);
    expect((await (await fetch(base + '/api/stages')).json()).stages).toHaveLength(0);
    const draft = emptyStage();
    const incomplete = await fetch(base + '/api/workshop/stages', {
      method: 'POST',
      headers,
      body: JSON.stringify(draft),
    });
    expect(incomplete.status).toBe(200);
    const privateList = await (await fetch(base + '/api/workshop/stages', { headers })).json();
    expect(privateList.stages).toHaveLength(1);
    expect(privateList.stages[0].stage.spawn.placed).toBe(false);
    const publicList = await (await fetch(base + '/api/stages')).json();
    expect(publicList.stages).toHaveLength(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
it('TLS 프록시의 실제 공개 출처를 검증하고 UTF-8 분할 전송을 보존한다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-workshop-proxy-'));
  await mkdir(path.join(root, 'data/stages'), { recursive: true });
  const original = process.env.STAGE_PUBLIC_ORIGIN;
  process.env.STAGE_PUBLIC_ORIGIN = 'https://workshop.example.test';
  const key = 'test-only-proxy-auth-key-123456789';
  const handler = workshopApi(
    root,
    parseStage,
    () =>
      Promise.resolve({
        done: true,
        errors: [],
        referenceWins: 1,
        simpleWins: [],
        randomWins: 0,
        total: 16,
      }),
    key,
  );
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  const base = `http://127.0.0.1:${address.port}`,
    headers = {
      Authorization: 'Bearer ' + key,
      Origin: 'https://workshop.example.test',
      'Content-Type': 'application/json',
    };
  try {
    expect((await fetch(base + '/api/workshop/stages', { headers })).status).toBe(200);
    expect(
      (
        await fetch(base + '/api/workshop/stages', {
          headers: { ...headers, Origin: 'https://different.example.test' },
        })
      ).status,
    ).toBe(403);
    const stage = blankStage();
    stage.published = false;
    stage.title = '한글의 별 · 🚀';
    const bytes = Buffer.from(JSON.stringify(stage));
    const response = await new Promise<number>((resolve, reject) => {
      const req = request(base + '/api/workshop/stages', { method: 'POST', headers }, (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode!));
      });
      req.once('error', reject);
      void (async () => {
        for (let i = 0; i < bytes.length; i += 7) {
          req.write(bytes.subarray(i, i + 7));
          await new Promise<void>((r) => setImmediate(r));
        }
        req.end();
      })();
    });
    expect(response).toBe(200);
    const stored = JSON.parse(
      await readFile(path.join(root, 'data/stages', stage.id + '.json'), 'utf8'),
    );
    expect(stored.title).toBe(stage.title);
  } finally {
    if (original === undefined) delete process.env.STAGE_PUBLIC_ORIGIN;
    else process.env.STAGE_PUBLIC_ORIGIN = original;
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
it('독립 제작자의 생성·수정·비공개·삭제가 목록에 반영되고 긴 검사 중 읽기가 가능하다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-workshop-two-clients-'));
  await mkdir(path.join(root, 'data/stages'), { recursive: true });
  const token = 'test-shared-editor-key-123456789';
  let release: ((check: PublicationCheck) => void) | undefined;
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const handler = workshopApi(
    root,
    parseStage,
    () => {
      entered?.();
      return new Promise<PublicationCheck>((resolve) => {
        release = resolve;
      });
    },
    token,
  );
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const stage = blankStage();
  const inspect = async () => (await (await fetch(base + '/api/stages')).json()).stages;
  const save = (method: string, revision?: string) =>
    fetch(base + '/api/workshop/stages' + (method === 'POST' ? '' : '/' + stage.id), {
      method,
      headers: { ...auth, ...(revision ? { 'If-Match': revision } : {}) },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(stage) }),
    });
  try {
    stage.published = true;
    const creating = save('POST');
    await started;
    // Client B can read before client A's audit is released; no stalled HTTP loop.
    expect(await inspect()).toEqual([]);
    release!({
      done: true,
      errors: [],
      referenceWins: 1,
      simpleWins: [],
      randomWins: 0,
      total: 16,
    });
    const first = await (await creating).json();
    expect((await inspect())[0].stage.id).toBe(stage.id);
    stage.title = '제작자 B 수정';
    stage.published = false;
    const second = await (await save('PUT', first.revision)).json();
    expect(await inspect()).toEqual([]);
    expect((await save('PUT', first.revision)).status).toBe(409);
    expect((await save('DELETE', second.revision)).ok).toBe(true);
    expect(await inspect()).toEqual([]);
    for (let i = 0; i < 12; i++)
      expect((await fetch(base + '/api/workshop/stages')).status).toBe(403);
    expect((await fetch(base + '/api/workshop/stages')).status).toBe(429);
    expect((await fetch(base + '/api/stages')).status).toBe(200);
  } finally {
    release?.({
      done: true,
      errors: [],
      referenceWins: 1,
      simpleWins: [],
      randomWins: 0,
      total: 16,
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
