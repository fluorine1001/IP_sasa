import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { postgresStageStorage, type SqlPool } from '../scripts/workshop-postgres';
import { blankStage } from '../src/stages/factory';
import { workshopExampleDrafts, workshopExamplesVersion } from '../scripts/workshop-examples';
import { fileStageStorage } from '../scripts/workshop-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

it('파일→DB 초기 이관은 초안의 플래그가 아니라 실제 공개 스냅샷과 철회를 보존한다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-release-seed-'));
  const db = new PGlite();
  const query = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);
  const pool: SqlPool = {
    query,
    end: () => db.close(),
    async connect() {
      return { query, release() {} };
    },
  };
  try {
    const files = fileStageStorage(root),
      s = blankStage();
    const publicRaw = JSON.stringify({ ...s, title: '마지막 공개본', published: true });
    let saved = await files.mutate('POST', s.id, publicRaw, undefined, 'publish');
    const draft = JSON.stringify({ ...s, title: '미공개 수정본', published: false });
    await files.mutate('PUT', s.id, draft, saved.revision, 'draft');
    const withdrawn = blankStage(),
      withdrawnRaw = JSON.stringify({ ...withdrawn, published: true });
    saved = await files.mutate('POST', withdrawn.id, withdrawnRaw, undefined, 'publish');
    // Explicit withdrawal takes precedence over a legacy raw published flag.
    await files.mutate('PUT', withdrawn.id, withdrawnRaw, saved.revision, 'withdraw');
    const store = await postgresStageStorage('postgres://localhost/test?sslmode=disable', pool);
    await store.seed!(await files.list(), 'file-snapshots');
    expect((await store.get(s.id))!.raw).toBe(draft);
    expect((await store.get(s.id))!.publishedRaw).toBe(publicRaw);
    expect((await store.get(withdrawn.id))!.publishedRaw).toBeUndefined();
  } finally {
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
it('이식 가능한 실제 PostgreSQL 저장은 다중 제작자 충돌·삭제 보존·복원을 원자적으로 처리한다', async () => {
  const db = new PGlite();
  const query = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);
  let tail = Promise.resolve();
  const pool: SqlPool = {
    query,
    end: () => db.close(),
    async connect() {
      let unlock!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
      return { query, release: unlock };
    },
  };
  const a = await postgresStageStorage('postgres://localhost/test?sslmode=disable', pool),
    b = await postgresStageStorage('postgres://localhost/test?sslmode=disable', pool);
  const stage = blankStage(),
    raw = JSON.stringify(stage);
  try {
    const first = await a.mutate('POST', stage.id, raw, undefined);
    expect((await b.list())[0].raw).toBe(raw);
    await expect(b.mutate('POST', stage.id, raw, undefined)).rejects.toMatchObject({ status: 409 });
    const attempts = await Promise.allSettled([
      a.mutate('PUT', stage.id, raw + ' ', first.revision),
      b.mutate('PUT', stage.id, raw + '  ', first.revision),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await a.get(stage.id))!;
    await a.seed!([{ raw, revision: first.revision! }]);
    await b.mutate('DELETE', stage.id, undefined, current.revision);
    await b.seed!([{ raw, revision: first.revision! }]);
    expect(await a.list()).toEqual([]);
    expect((await query('SELECT raw FROM workshop_stages WHERE deleted')).rows[0].raw).toBe(
      current.raw,
    );
    expect((await query('SELECT * FROM workshop_history')).rows).toHaveLength(2);
    await a.mutate('POST', stage.id, raw, undefined);
    expect((await b.get(stage.id))!.raw).toBe(raw);
    const examples = workshopExampleDrafts();
    expect(examples).toHaveLength(18);
    const ids = examples.map((e) => JSON.parse(e.raw).id as string);
    expect(new Set(ids).size).toBe(18);
    expect(workshopExampleDrafts().map((e) => JSON.parse(e.raw).id)).toEqual(ids);
    expect(
      examples.every(
        (e) => !JSON.parse(e.raw).published && JSON.parse(e.raw).referencePlans.length === 0,
      ),
    ).toBe(true);
    // A named, one-shot deployment batch works after the original catalog seed.
    await a.seed!(examples, workshopExamplesVersion);
    expect(await b.list()).toHaveLength(19);
    for (const entry of examples) expect(await b.get(JSON.parse(entry.raw).id)).toEqual(entry);
    const original = (await a.get(ids[0]))!;
    const edited = JSON.stringify({ ...JSON.parse(original.raw), title: '제작자가 수정한 사례' });
    const saved = await b.mutate('PUT', ids[0], edited, original.revision);
    const removed = (await a.get(ids[1]))!;
    await a.mutate('DELETE', ids[1], undefined, removed.revision);
    await Promise.all([
      a.seed!(workshopExampleDrafts(), workshopExamplesVersion),
      b.seed!(examples, workshopExamplesVersion),
    ]);
    expect((await a.get(ids[0]))!.raw).toBe(edited);
    expect((await a.get(ids[0]))!.revision).toBe(saved.revision);
    expect(await a.get(ids[1])).toBeUndefined();
    expect((await a.get(stage.id))!.raw).toBe(raw);
    expect(await a.list()).toHaveLength(18);
    // Even a future batch containing the old UUID cannot resurrect a tombstone.
    await a.seed!(examples, 'future-example-batch');
    expect(await b.get(ids[1])).toBeUndefined();
    expect((await b.get(ids[0]))!.raw).toBe(edited);
    const currentExample = (await a.get(ids[0]))!;
    const releaseRaw = JSON.stringify({
      ...JSON.parse(currentExample.raw),
      title: '게임 공개본',
      published: true,
    });
    const released = await a.mutate('PUT', ids[0], releaseRaw, currentExample.revision, 'publish');
    const draftRaw = JSON.stringify({
      ...JSON.parse(releaseRaw),
      title: '미공개 편집본',
      published: false,
    });
    const draft = await b.mutate('PUT', ids[0], draftRaw, released.revision, 'draft');
    expect((await a.get(ids[0]))!.publishedRaw).toBe(releaseRaw);
    expect((await a.get(ids[0]))!.raw).toBe(draftRaw);
    const restarted = await postgresStageStorage('postgres://localhost/test?sslmode=disable', pool);
    expect((await restarted.get(ids[0]))!.publishedRaw).toBe(releaseRaw);
    await restarted.mutate('PUT', ids[0], draftRaw, draft.revision, 'withdraw');
    expect((await a.get(ids[0]))!.publishedRaw).toBeUndefined();
  } finally {
    await db.close();
  }
}, 30_000);
