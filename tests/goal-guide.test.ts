import { expect, it } from 'vitest';
import { goalExplanation, missionGoalsHtml } from '../src/screens/flight/goal-guide';
import { parseStage } from '../src/stages/validation';
import source from '../data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json';

const stage = parseStage(source);
it('목표 범위·유지 시간·분리 상태를 수식 대신 결과 상태로 설명한다', () => {
  const text = goalExplanation(stage, stage.goals[0].condition);
  expect(text).toContain('중심까지 거리');
  expect(text).toContain('1바퀴');
  expect(text).toContain('엔진 꺼짐');
  expect(text).not.toContain('찌그러짐');
  expect(text).toContain('분리');
  expect(text).not.toMatch(/AND|OR|sqrt|≥|≤|(^|\n)\s*\d+\.\s/);
});
it('본편 성공 조건 창에는 제작자 브리핑이나 조작 절차를 가져오지 않는다', () => {
  const campaign = structuredClone(stage);
  campaign.track = 'campaign';
  campaign.description = '출력을 높여보세요';
  campaign.learning!.briefing = '먼저 점화하고 다음에 제동하세요';
  const html = missionGoalsHtml(campaign);
  expect(html).not.toContain(campaign.description);
  expect(html).not.toContain(campaign.learning!.briefing);
  expect(html).not.toMatch(/하세요|그다음|정답값/);
  expect(html).toContain('criterion-list');
});
it('에너지와 한 바퀴 통계를 물리 수식으로 노출하지 않는다', () => {
  expect(
    goalExplanation(stage, {
      kind: 'compare',
      left: { kind: 'metric', metric: 'energy', targetId: stage.bodies[0].id },
      operator: 'gt',
      right: { kind: 'constant', value: 0 },
    }),
  ).toContain('벗어날 만큼 빠르게');
  expect(
    goalExplanation(stage, {
      kind: 'compare',
      left: {
        kind: 'window',
        operation: 'coverage',
        value: { kind: 'constant', value: 1 },
        domain: { kind: 'metric', metric: 'angularTravel', targetId: stage.bodies[0].id },
        width: { kind: 'constant', value: Math.PI * 2 },
      },
      operator: 'gte',
      right: { kind: 'constant', value: 0.99999999 },
    }),
  ).toContain('1바퀴');
});
it('반복되는 조건은 "위 상태를 … 유지"로 묶고 착륙 한계는 두 속도를 숫자로 보여 준다', () => {
  const text = goalExplanation(stage, stage.goals[0].condition);
  expect(text).toMatch(/[위아]래? ?상태를 4초 동안 계속 유지/);
  expect(text.split('\n').filter((line) => line.includes('중심까지 거리'))).toHaveLength(1);
  const landing = goalExplanation(stage, {
    kind: 'compare',
    operator: 'lte',
    left: {
      kind: 'calculate',
      operation: 'add',
      args: (['touchdownNormalSpeed', 'touchdownTangentialSpeed'] as const).map((metric, i) => ({
        kind: 'calculate' as const,
        operation: 'multiply' as const,
        args: [0, 1].map(() => ({
          kind: 'calculate' as const,
          operation: 'divide' as const,
          args: [
            { kind: 'metric' as const, metric, targetId: '' },
            { kind: 'constant' as const, value: [0.27, 0.54][i] },
          ],
        })),
      })),
    },
    right: { kind: 'constant', value: 1.00000002 },
  });
  expect(landing).toBe('착륙 속도: 수직 0.27 u/s, 옆 0.54 u/s 안쪽');
});
