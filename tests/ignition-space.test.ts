import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { solutionSpace } from '../src/editor/solution-space';
import { programEvents } from '../src/world/program';
it('재점화 한도를 반드시 넘는 단어는 모든 시각·출력 조합을 문법 DP에서 제거한다', () => {
  const stage = blankStage();
  stage.rocket!.parts = [stage.rocket!.parts[0]];
  stage.rocket!.parts[0].ignitionLimit = 1;
  stage.rules.commandLimits = { ignite: 3, stop: 3, turn: 0, separate: 0, push: 0 };
  const space = solutionSpace(stage, 6);
  const words: string[][] = [];
  for (let next = space.next(); next; next = space.next())
    words.push(
      programEvents(next.plan)
        .filter((e) => e.id !== 'launch')
        .map((e) => e.kind),
    );
  expect(words).not.toContainEqual(['stop', 'ignite', 'stop', 'ignite']);
  expect(words).toContainEqual(['ignite', 'ignite', 'ignite']);
  expect(words).toContainEqual(['stop', 'ignite']);
  expect(Number(space.total)).toBe(words.length);
});
it('분리체·새 단의 점화 상태를 분리해 서로의 재점화를 잘못 차단하지 않는다', () => {
  const stage = blankStage();
  stage.rocket!.parts = stage.rocket!.parts.slice(0, 2);
  stage.rocket!.parts.forEach((p) => (p.ignitionLimit = 1));
  stage.rules.commandLimits = { ignite: 2, stop: 1, turn: 0, separate: 1, push: 0 };
  const space = solutionSpace(stage, 3);
  let found = false;
  for (let next = space.next(); next; next = space.next()) {
    const events = programEvents(next.plan).filter((e) => e.id !== 'launch');
    if (
      events.length === 3 &&
      events[0].kind === 'separate' &&
      events[1].kind === 'ignite' &&
      events[2].kind === 'ignite' &&
      new Set(events.slice(1).map((e) => e.actorId)).size === 2
    )
      found = true;
  }
  expect(found).toBe(true);
});
it('몫 상태 DP의 개수는 모든 짧은 단어를 독립적으로 판정한 결과와 일치한다', () => {
  for (const limit of [1, 2, 3]) {
    const stage = blankStage();
    stage.rocket!.parts = [stage.rocket!.parts[0]];
    stage.rocket!.parts[0].ignitionLimit = limit;
    stage.rules.commandLimits = { ignite: 3, stop: 3, turn: 0, separate: 0, push: 0 };
    let expected = 0;
    function enumerate(depth: number, on: boolean, used: number, a: number, b: number) {
      expected++;
      if (depth === 6) return;
      if (a < 3 && (on || used < limit)) enumerate(depth + 1, true, used + Number(!on), a + 1, b);
      if (b < 3) enumerate(depth + 1, false, used, a, b + 1);
    }
    enumerate(0, true, 0, 0, 0);
    const space = solutionSpace(stage, 6);
    let found = 0;
    for (let next = space.next(); next; next = space.next()) found++;
    expect(found).toBe(expected);
    expect(Number(space.total)).toBe(expected);
  }
});
