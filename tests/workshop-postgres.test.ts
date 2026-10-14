import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { postgresStageStorage, type SqlPool } from '../scripts/workshop-postgres';
import { blankStage } from '../src/stages/factory';
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
  } finally {
    await db.close();
  }
}, 30_000);
