import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readStageRelease, stageReleasePath } from '../scripts/stage-release';

it('공개 스냅샷의 원문을 보존하고 Git의 철회 기록이 이전 로컬 공개본보다 우선한다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-release-'));
  const id = 'd224ff94-37f3-4c04-a580-7d6e26ff6274';
  try {
    const legacy = path.join(root, '.stage-workshop/releases');
    await mkdir(legacy, { recursive: true });
    const raw = JSON.stringify({ id, title: '기존 공개본', published: true }, null, 2) + '\n';
    await writeFile(path.join(legacy, id + '.json'), JSON.stringify({ raw }));
    expect(await readStageRelease(root, id)).toEqual({ raw });
    await mkdir(path.join(root, 'data/releases'), { recursive: true });
    const next = JSON.stringify({ id, title: '공유 공개본', published: true }, null, 2) + '\n';
    await writeFile(stageReleasePath(root, id), next);
    expect(await readStageRelease(root, id)).toEqual({ raw: next });
    await writeFile(stageReleasePath(root, id), 'null\n');
    expect(await readStageRelease(root, id)).toEqual({ raw: null });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('깨진 공개 스냅샷을 무시하고 더 오래된 스테이지를 배포하지 않는다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-invalid-release-'));
  const id = 'd224ff94-37f3-4c04-a580-7d6e26ff6274';
  try {
    expect(await readStageRelease(root, id)).toBeUndefined();
    await mkdir(path.join(root, 'data/releases'), { recursive: true });
    await writeFile(stageReleasePath(root, id), JSON.stringify({ id, published: false }));
    await expect(readStageRelease(root, id)).rejects.toThrow('Invalid published');
    expect(() => stageReleasePath(root, '../outside')).toThrow('Invalid release UUID');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
