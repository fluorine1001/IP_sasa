import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { fileStageStorage } from '../scripts/workshop-storage';
import { postgresStageStorage, type SqlPool } from '../scripts/workshop-postgres';
import { workshopCampaignEntries, workshopCampaignVersion } from '../scripts/workshop-campaign';

it('배포의 신규 임무는 5개 공개·1개 초안으로 추가하되 기존 수정본과 삭제본을 보존한다', async () => {
  const entries = workshopCampaignEntries(await fileStageStorage(process.cwd()).list());
  expect(entries).toHaveLength(6);
  expect(entries.filter((entry) => entry.publishedRaw)).toHaveLength(5);
  const db = new PGlite(),
    query = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);
  const pool: SqlPool = {
    query,
    end: () => db.close(),
    async connect() {
      return { query, release() {} };
    },
  };
  try {
    const storage = await postgresStageStorage('postgres://localhost/test?sslmode=disable', pool),
      id = JSON.parse(entries[0].raw).id,
      raw = JSON.stringify({ ...JSON.parse(entries[0].raw), title: '서버에서 먼저 수정한 원본' });
    await storage.mutate('POST', id, raw, undefined, 'draft');
    await storage.seed!(entries, workshopCampaignVersion);
    expect((await storage.get(id))!.raw).toBe(raw);
    expect((await storage.get(id))!.publishedRaw).toBeUndefined();
    for (const entry of entries.slice(1))
      expect(await storage.get(JSON.parse(entry.raw).id)).toEqual(entry);
    const removed = JSON.parse(entries[1].raw).id,
      row = (await storage.get(removed))!;
    await storage.mutate('DELETE', removed, undefined, row.revision);
    await storage.seed!(entries, workshopCampaignVersion);
    expect(await storage.get(removed)).toBeUndefined();
    expect((await storage.get(id))!.raw).toBe(raw);
  } finally {
    await db.close();
  }
}, 30000);
