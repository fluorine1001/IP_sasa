import { expect, it } from 'vitest';
import { goalExplanation, missionGoalsHtml } from '../src/screens/flight/goal-guide';
import { parseStage } from '../src/stages/validation';
import source from '../data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json';

const stage = parseStage(source);
it('목표 범위·유지 시간·분리 상태를 수식 대신 결과 상태로 설명한다', () => {
  const text = goalExplanation(stage, stage.goals[0].condition);
  expect(text).toContain('중심 거리');
  expect(text).toContain('1바퀴 전체');
  expect(text).toContain('엔진 꺼짐');
  expect(text).not.toContain('찌그러짐');
  expect(text).toContain('분리된 상태');
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
  ).toContain('벗어날 에너지');
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
