import pg from 'pg';
import {
  StorageError,
  stageRevision,
  type StageStorage,
  type StoredStage,
} from './workshop-storage';
export type SqlConnection = {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
};
export type SqlPool = {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<SqlConnection>;
  end(): Promise<void>;
};
export async function postgresStageStorage(
  connectionString: string,
  supplied?: SqlPool,
): Promise<StageStorage> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw Error('유효한 PostgreSQL 연결 주소가 필요합니다. 비밀 환경 변수에서 확인하세요.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw Error('PostgreSQL 연결 주소가 필요합니다.');
  // No TLS certificate bypass, even if a copied connection URI requests it.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const plain = local && url.searchParams.get('sslmode') === 'disable';
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const pool: SqlPool =
    supplied ??
    new pg.Pool({
      connectionString: url.toString(),
      max: 3,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
      ssl: plain ? false : { rejectUnauthorized: true },
    });
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS workshop_stages (id uuid PRIMARY KEY, raw text NOT NULL, revision text NOT NULL, deleted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now())',
    'CREATE TABLE IF NOT EXISTS workshop_history (entry bigserial PRIMARY KEY, id uuid NOT NULL, raw text NOT NULL, revision text NOT NULL, operation text NOT NULL, archived_at timestamptz NOT NULL DEFAULT now())',
    'CREATE TABLE IF NOT EXISTS workshop_meta (name text PRIMARY KEY)',
    'ALTER TABLE workshop_stages ADD COLUMN IF NOT EXISTS published_raw text',
    'ALTER TABLE workshop_stages ADD COLUMN IF NOT EXISTS published_revision text',
  ])
    await pool.query(sql);
  const migration = await pool.connect();
  try {
    await migration.query('BEGIN');
    const first = await migration.query(
      "INSERT INTO workshop_meta(name) VALUES('publication-snapshot-v1') ON CONFLICT DO NOTHING RETURNING name",
    );
    if (first.rows.length)
      await migration.query(
        "UPDATE workshop_stages SET published_raw=raw,published_revision=revision WHERE NOT deleted AND COALESCE((raw::jsonb->>'published')::boolean,true)",
      );
    await migration.query('COMMIT');
  } catch (error) {
    await migration.query('ROLLBACK');
    throw error;
  } finally {
    migration.release();
  }
  const row = (r: Record<string, unknown>): StoredStage => ({
    raw: String(r.raw),
    revision: String(r.revision),
    ...(r.published_raw
      ? { publishedRaw: String(r.published_raw), publishedRevision: String(r.published_revision) }
      : {}),
  });
  return {
    async list() {
      return (
        await pool.query(
          'SELECT raw,revision,published_raw,published_revision FROM workshop_stages WHERE NOT deleted ORDER BY id',
        )
      ).rows.map(row);
    },
    async get(id) {
      const result = await pool.query(
        'SELECT raw,revision,published_raw,published_revision FROM workshop_stages WHERE id=$1 AND NOT deleted',
        [id],
      );
      return result.rows[0] ? row(result.rows[0]) : undefined;
    },
    async seed(entries, version = 'seeded') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const first = await client.query(
          'INSERT INTO workshop_meta(name) VALUES($1) ON CONFLICT DO NOTHING RETURNING name',
          [version],
        );
        if (first.rows.length)
          for (const entry of entries) {
            const id = JSON.parse(entry.raw).id;
            await client.query(
              'INSERT INTO workshop_stages(id,raw,revision,published_raw,published_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
              [
                id,
                entry.raw,
                stageRevision(entry.raw),
                // File storage already resolves legacy snapshots/withdrawals.
                // Never re-infer publication from the editable draft's flag.
                entry.publishedRaw ?? null,
                entry.publishedRaw ? stageRevision(entry.publishedRaw) : null,
              ],
            );
          }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async mutate(method, id, raw, expected, publication) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
            'SELECT raw,revision,deleted,published_raw,published_revision FROM workshop_stages WHERE id=$1 FOR UPDATE',
            [id],
          ),
          previous = result.rows[0],
          exists = previous && !previous.deleted;
        if (method === 'POST' && exists)
          throw new StorageError(409, '이미 있는 스테이지입니다. 최신본을 열어 수정하세요.');
        if (method !== 'POST' && !exists) throw new StorageError(404, '스테이지가 없습니다.');
        if (exists && expected !== previous.revision)
          throw new StorageError(409, '다른 제작자가 수정했습니다. 최신본을 다시 열어 비교하세요.');
        const mode =
          publication ?? (raw && JSON.parse(raw).published !== false ? 'publish' : 'withdraw');
        const publishedRaw =
          method === 'DELETE' || mode === 'withdraw'
            ? null
            : mode === 'publish'
              ? raw!
              : (previous?.published_raw ?? null);
        const publishedRevision = publishedRaw ? stageRevision(String(publishedRaw)) : null;
        if (previous)
          await client.query(
            'INSERT INTO workshop_history(id,raw,revision,operation) VALUES($1,$2,$3,$4)',
            [id, previous.raw, previous.revision, method],
          );
        if (method === 'DELETE')
          await client.query(
            'UPDATE workshop_stages SET deleted=true,published_raw=NULL,published_revision=NULL,updated_at=now() WHERE id=$1',
            [id],
          );
        else if (previous)
          await client.query(
            'UPDATE workshop_stages SET raw=$2,revision=$3,published_raw=$4,published_revision=$5,deleted=false,updated_at=now() WHERE id=$1',
            [id, raw, stageRevision(raw!), publishedRaw, publishedRevision],
          );
        else
          await client.query(
            'INSERT INTO workshop_stages(id,raw,revision,published_raw,published_revision) VALUES($1,$2,$3,$4,$5)',
            [id, raw, stageRevision(raw!), publishedRaw, publishedRevision],
          );
        await client.query('COMMIT');
        return method === 'DELETE' ? {} : { revision: stageRevision(raw!) };
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505')
          throw new StorageError(409, '다른 제작자가 같은 ID를 먼저 저장했습니다.');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
