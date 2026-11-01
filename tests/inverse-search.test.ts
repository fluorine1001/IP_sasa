import { expect, it } from 'vitest';
import { inverseSearch } from '../src/editor/inverse-search';
import { gravityInverse } from './fixtures/gravity-inverse';
import { execute } from '../src/world/engine';
import { windowSearchStage } from './fixtures/window-search';
import { searchParameters } from '../src/editor/solution-search';

it('제작소 역산기는 미지원 물리를 개별 발사 탐색으로 대체하지 않는다', () => {
  const { stage, template } = gravityInverse();
  stage.bodies[0].atmosphere = { density: 1, height: 1, scaleHeight: 1 };
  const snapshot = JSON.stringify(stage);
  const reports = [...inverseSearch(stage, [template], { global: false, budget: 32 })];
  const last = reports.at(-1)!;
  expect(last.evaluated).toBe(0);
  expect(last.families).toEqual([]);
  expect(last.inverse?.method).toBe('success-relation');
  expect(last.inverse?.unsupported).toBeGreaterThan(0);
  expect(last.inverse?.complete).toBe(false);
  expect(last.inverse?.issues.join(' ')).toContain('대기');
  expect(last.continuable).toBe(false);
  expect(JSON.stringify(stage)).toBe(snapshot);
});

it('성공 영역에서 나온 대표만 실제 엔진으로 검증하고 한 연결 영역을 반복 발사하지 않는다', () => {
  const { stage, template } = gravityInverse();
  const reports = [...inverseSearch(stage, [template], { global: false, budget: 512 })];
  const last = reports.at(-1)!;
  expect(last.projection?.regions).toBeGreaterThan(0);
  expect(last.evaluated).toBeGreaterThan(0);
  expect(last.evaluated).toBeLessThan(last.projection!.regions);
  expect(last.families.length).toBeGreaterThan(0);
  for (const family of last.families)
    expect(execute(stage, family.representative).status).toBe('won');
}, 30000);

it('시작 방향을 고정하지 않고 연속 방향·출력 관계에서 성공 영역을 구한다', () => {
  const stage = windowSearchStage();
  const plan = { launch: { x: 0, y: 0 }, impulses: [] };
  const template = {
    id: 'free-heading',
    label: '방향·출력',
    plan,
    parameters: searchParameters(stage, plan),
  };
  const last = [...inverseSearch(stage, [template], { budget: 256 })].at(-1)!;
  expect(last.inverse?.unsupported).toBe(0);
  expect(last.projection?.regions).toBeGreaterThan(0);
  expect(last.families.length).toBeGreaterThan(0);
  for (const family of last.families)
    expect(execute(stage, family.representative).status).toBe('won');
}, 30000);

it('작업 묶음 재개는 기존 관계 위치와 실제 대표 검증 수를 보존한다', () => {
  const { stage, template } = gravityInverse();
  const quota = { remaining: 4, total: 4 };
  const iterator = inverseSearch(stage, [template], { budget: 4, quota });
  let paused = iterator.next().value!;
  while (!paused.done) paused = iterator.next().value!;
  expect(paused.continuable).toBe(true);
  const work = paused.inverse!.work,
    evaluated = paused.evaluated;
  quota.remaining += 32;
  quota.total += 32;
  const resumed = iterator.next().value!;
  expect(resumed.inverse!.work).toBeGreaterThan(work);
  expect(resumed.evaluated).toBeGreaterThanOrEqual(evaluated);
  expect(resumed.budget).toBe(36);
  iterator.return(undefined);
}, 30000);
