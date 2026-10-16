import { timingSafeEqual } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import {
  fileStageStorage,
  stageRevision,
  StorageError,
  type StageStorage,
} from './workshop-storage';
export { stageRevision } from './workshop-storage';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Stage } from '../src/world/types';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type PublicationCheck = {
  done: boolean;
  errors: string[];
  referenceWins: number;
  simpleWins: string[];
  randomWins: number;
  total: number;
};
export function playerStage(stage: Stage): Stage {
  const copy = structuredClone(stage);
  copy.referencePlans = [];
  delete copy.randomization;
  return copy;
}
export function workshopApi(
  root: string,
  parse: (value: unknown, allowIncomplete?: boolean) => Stage,
  audit: (stage: Stage) => Iterable<PublicationCheck> | Promise<PublicationCheck>,
  token = process.env.STAGE_EDITOR_TOKEN ?? '',
  storage: StageStorage = fileStageStorage(root),
) {
  const external = process.env.STAGE_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
  const publicOrigin = external ? new URL(external).origin : undefined;
  const authFailures = new Map<string, { count: number; until: number }>();
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost'),
      publicRead = url.pathname === '/api/stages';
    const base = '/api/workshop/stages';
    const id = url.pathname.startsWith(base + '/') ? url.pathname.slice(base.length + 1) : '';
    const send = (code: number, value: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(value));
    };
    const origin = req.headers.origin;
    const ownOrigin =
      publicOrigin ??
      `${'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    const allowed = (process.env.STAGE_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
    if (!publicRead && origin && origin !== ownOrigin && !allowed.includes(origin))
      return send(403, { error: '허용하지 않은 출처입니다.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', publicRead ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match');
      return send(204, null);
    }
    if (publicRead && req.method !== 'GET')
      return send(405, { error: '플레이 목록은 읽기 전용입니다.' });
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? '');
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const expected = Buffer.from(token),
      actual = Buffer.from(supplied);
    const validToken =
      token.length >= 24 && actual.length === expected.length && timingSafeEqual(actual, expected);
    const address = req.socket.remoteAddress ?? 'unknown';
    const failures = authFailures.get(address);
    if (
      !publicRead &&
      !validToken &&
      failures &&
      failures.until > Date.now() &&
      failures.count >= 12
    ) {
      res.setHeader('Retry-After', String(Math.ceil((failures.until - Date.now()) / 1000)));
      return send(429, { error: '인증 실패가 반복되었습니다. 잠시 후 다시 시도하세요.' });
    }
    if (
      !publicRead &&
      !(validToken || (!token && local && localHost && (!origin || origin === ownOrigin)))
    ) {
      if (authFailures.size >= 1024) {
        for (const [key, entry] of authFailures)
          if (entry.until <= Date.now()) authFailures.delete(key);
        if (authFailures.size >= 1024) authFailures.delete(authFailures.keys().next().value!);
      }
      authFailures.set(address, {
        count: failures && failures.until > Date.now() ? failures.count + 1 : 1,
        until: failures && failures.until > Date.now() ? failures.until : Date.now() + 60_000,
      });
      return send(403, { error: '제작 권한이 필요합니다. 서버의 편집 키를 입력하세요.' });
    }
    if (!publicRead) authFailures.delete(address);
    if (!publicRead && url.pathname !== base && !uuid.test(id))
      return send(400, { error: 'UUID 경로가 아닙니다.' });
    try {
      if (req.method === 'GET' && (publicRead || !id)) {
        const entries = (await storage.list())
          .filter((e) => !publicRead || !!e.publishedRaw)
          .map((entry) => {
            const stage = parse(
              JSON.parse(publicRead ? entry.publishedRaw! : entry.raw),
              !publicRead,
            );
            return {
              stage: publicRead ? playerStage(stage) : stage,
              revision: publicRead ? entry.publishedRevision! : entry.revision,
              ...(!publicRead && entry.publishedRaw
                ? {
                    publication: {
                      title: JSON.parse(entry.publishedRaw).title,
                      revision: entry.publishedRevision,
                    },
                  }
                : {}),
            };
          });
        return send(200, {
          stages: entries
            .filter((entry) => !publicRead || entry.stage.published !== false)
            .sort((a, b) => a.stage.order - b.stage.order),
        });
      }
      if (req.method === 'GET' && id) {
        const entry = await storage.get(id);
        if (!entry) return send(404, { error: '스테이지가 없습니다.' });
        res.setHeader('ETag', entry.revision);
        return send(200, {
          stage: parse(JSON.parse(entry.raw), true),
          revision: entry.revision,
          ...(entry.publishedRaw
            ? {
                publication: {
                  title: JSON.parse(entry.publishedRaw).title,
                  revision: entry.publishedRevision,
                },
              }
            : {}),
        });
      }
      if (!['POST', 'PUT', 'DELETE'].includes(req.method ?? ''))
        return send(405, { error: '지원하지 않은 요청입니다.' });
      let raw = '';
      const decoder = new StringDecoder('utf8');
      let bytes = 0;
      if (req.method !== 'DELETE') {
        if (!req.headers['content-type']?.startsWith('application/json'))
          return send(415, { error: 'JSON만 저장합니다.' });
        for await (const chunk of req) {
          bytes += chunk.length;
          raw += decoder.write(chunk);
          if (bytes > 1_000_000) return send(413, { error: '스테이지가 너무 큽니다.' });
        }
      }
      raw += decoder.end();
      const data = req.method === 'DELETE' ? undefined : parse(JSON.parse(raw), true);
      const release = url.searchParams.get('release');
      if (release && !['draft', 'publish', 'withdraw'].includes(release))
        return send(400, { error: '알 수 없는 공개 작업입니다.' });
      const publication =
        release === 'draft'
          ? 'draft'
          : release === 'withdraw'
            ? 'withdraw'
            : data?.published || release === 'publish'
              ? 'publish'
              : 'withdraw';
      if (data) data.published = publication === 'publish';
      if (data && id && data.id !== id)
        return send(400, { error: '경로와 스테이지 ID가 다릅니다.' });
      if (data && publication === 'publish') {
        let checked;
        const inspection = audit(data);
        if ('then' in inspection) checked = await inspection;
        else
          for (const result of inspection) {
            checked = result;
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        if (
          !checked?.done ||
          checked.errors.length ||
          !checked.referenceWins ||
          checked.simpleWins.length ||
          checked.randomWins / checked.total > data.audit.maxPassRate
        )
          return send(422, {
            error: '공개 검사에 통과하지 못했습니다. 기준 성공 계획과 반례 검사를 확인하세요.',
          });
      }
      const targetId = id || data!.id;
      const contents = data ? JSON.stringify(data, null, 2) + '\n' : undefined;
      const written = await storage.mutate(
        req.method as 'POST' | 'PUT' | 'DELETE',
        targetId,
        contents,
        req.headers['if-match'],
        publication,
      );
      return send(200, {
        ok: true,
        id: targetId,
        ...written,
        ...(req.method === 'DELETE' ? { recoverable: true } : {}),
      });
    } catch (error) {
      return send(
        error instanceof StorageError
          ? error.status
          : (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 404
            : 400,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };
}
