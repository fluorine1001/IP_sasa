import { it, expect } from 'vitest';
import { playerStages } from '../vite.config';
import { fileStageStorage } from '../scripts/workshop-storage';
import { emptyStage } from '../src/stages/factory';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
it('플레이 빌드는 제작용 정답/변형 계획을 제거하고 장면과 규칙을 유지한다', async () => {
  const plugin = playerStages(),
    hook = plugin.transform;
  const transform = typeof hook === 'function' ? hook : hook!.handler;
  const fixture = {
    id: 'sample',
    rules: { maxTime: 10 },
    referencePlans: [{ secret: 'private-proof-sentinel' }],
    randomization: { proof: 'variation-sentinel' },
  };
  const result = await transform.call(
    {} as never,
    JSON.stringify(fixture),
    '/repo/data/stages/sample.json',
  );
  expect(result).toBeTruthy();
  if (result && typeof result !== 'string') {
    const player = JSON.parse(String(result.code));
    expect(player.referencePlans).toEqual([]);
    expect(player.randomization).toBeUndefined();
    expect(player.rules).toEqual(fixture.rules);
    expect(result.code).not.toContain('private-proof-sentinel');
    expect(result.code).not.toContain('variation-sentinel');
  }
});

it('로컬 저장소의 마지막 공개본을 빌드하며 미공개 수정은 기존 게임을 덮어쓰지 않는다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-release-build-'));
  try {
    const storage = fileStageStorage(root),
      stage = emptyStage();
    stage.title = '공개된 이름';
    stage.published = true;
    let result = await storage.mutate(
      'POST',
      stage.id,
      JSON.stringify(stage),
      undefined,
      'publish',
    );
    stage.title = '공개 전 수정';
    stage.published = false;
    result = await storage.mutate('PUT', stage.id, JSON.stringify(stage), result.revision, 'draft');
    const hook = playerStages(root).transform,
      transform = typeof hook === 'function' ? hook : hook!.handler;
    const build = async () => {
      const output = await transform.call(
        {} as never,
        JSON.stringify(stage),
        path.join(root, 'data/stages', stage.id + '.json'),
      );
      if (!output || typeof output === 'string') throw Error('Expected stage transform');
      return JSON.parse(String(output.code));
    };
    expect((await build()).title).toBe('공개된 이름');
    expect((await build()).published).toBe(true);
    stage.published = true;
    result = await storage.mutate(
      'PUT',
      stage.id,
      JSON.stringify(stage),
      result.revision,
      'publish',
    );
    expect((await build()).title).toBe('공개 전 수정');
    stage.published = false;
    await storage.mutate('PUT', stage.id, JSON.stringify(stage), result.revision, 'withdraw');
    expect((await build()).published).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('Git으로 공유한 data만 있는 새 clone도 편집 중인 초안이 아닌 마지막 공개 스냅샷을 빌드한다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-published-source-'));
  const clone = await mkdtemp(path.join(os.tmpdir(), 'orbit-published-clone-'));
  try {
    const storage = fileStageStorage(root),
      stage = emptyStage();
    stage.published = true;
    stage.title = '협업자에게도 같은 공개본';
    let saved = await storage.mutate('POST', stage.id, JSON.stringify(stage), undefined, 'publish');
    stage.published = false;
    stage.title = '아직 제작 중인 수정';
    saved = await storage.mutate('PUT', stage.id, JSON.stringify(stage), saved.revision, 'draft');
    await cp(path.join(root, 'data'), path.join(clone, 'data'), { recursive: true });
    const copy = await fileStageStorage(clone).get(stage.id);
    expect(JSON.parse(copy!.publishedRaw!).title).toBe('협업자에게도 같은 공개본');
    expect(JSON.parse(copy!.raw).title).toBe('아직 제작 중인 수정');
    const hook = playerStages(clone).transform,
      transform = typeof hook === 'function' ? hook : hook!.handler;
    const output = await transform.call(
      {} as never,
      copy!.raw,
      path.join(clone, 'data/stages', stage.id + '.json'),
    );
    if (!output || typeof output === 'string') throw Error('Missing stage transform');
    expect(JSON.parse(String(output.code)).title).toBe('협업자에게도 같은 공개본');
    expect(JSON.parse(String(output.code)).referencePlans).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(clone, { recursive: true, force: true });
  }
});
