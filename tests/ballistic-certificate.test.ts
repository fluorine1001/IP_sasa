import { it, expect } from 'vitest';
import { blankStage, newObject } from '../src/stages/factory';
import { ballisticTimeCertificate } from '../src/editor/research/ballistic-certificate';
import { execute } from '../src/world/engine';

function stage() {
  const s = blankStage();
  s.rocket = undefined;
  s.launchBodyId = undefined;
  s.spawn.position = { x: 2, y: 0 };
  s.bodies[0].mu = 0;
  s.rules.maxTime = s.audit.timeLimit = 0.2;
  s.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.19 },
  };
  return s;
}
it('기체별 시점 조합 대신 삼각부등식 제어 관 전체의 접촉 부재를 증명한다', () => {
  const s = stage();
  expect(ballisticTimeCertificate(s, 0.2)).toBe(true);
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
    for (const first of [0, 0.05, 0.15]) {
      const v = { x: Math.cos(angle), y: Math.sin(angle) };
      const plan = {
        launch: { x: v.x, y: v.y },
        impulses: [
          { id: 'a', time: first, vector: { x: -0.05 * v.x, y: -0.05 * v.y } },
          { id: 'b', time: 0.19, vector: { x: 0.05 * v.x, y: 0.05 * v.y } },
        ],
      };
      expect(execute(s, plan).status).toBe('won');
    }
});
it('접촉·경계 이탈·중력 가능성이 있으면 시간 조건만 보고 생략하지 않는다', () => {
  const s = stage();
  s.spawn.position.x = 0.7;
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
  s.spawn.position.x = 2;
  s.rules.worldRadius = 2.1;
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
  s.rules.worldRadius = 14;
  s.bodies[0].mu = 0.01;
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
  s.bodies[0].mu = 0;
  s.objects = [{ ...newObject('station'), position: { x: 2.1, y: 0 } }];
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
});
it('짧은 창·누적 이력·존재하지 않는 기체를 단순 시간 문턱으로 오인하지 않는다', () => {
  const s = stage(),
    original = s.goals[0].condition;
  s.goals[0].endTime = 0.19;
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
  s.goals[0].endTime = 40;
  s.goals[0].condition = { kind: 'hold', duration: 0.1, child: original };
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
  s.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', actorId: 'missing', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.19 },
  };
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
  s.spawn.velocity.x = NaN;
  expect(ballisticTimeCertificate(s, 0.2)).toBe(false);
});
