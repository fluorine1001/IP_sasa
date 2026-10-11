import { captureFrame, type FlightFrame } from './replay';
import { evaluateCondition, expressionValue, type Condition, type Expression } from './conditions';
import type { GoalContext, GoalProgress, RoutePlan, Run, Stage } from './types';
import { length } from '../physics/vector';

// Author-defined observations share the goal language, but never change goal state.
export type Instrument = {
  id: string;
  label: string;
  value: Expression;
  when: Condition;
  summary: 'min' | 'max' | 'last';
  range: { min: number; max: number; below: string; inside: string; above: string };
};
export type LearningDesign = {
  briefing: string;
  instruments: Instrument[];
  cues: { id: string; message: string; when: Condition; pause: boolean }[];
};
export type Reading = { value: number; time: number; count: number };
export type EvidenceState = {
  readings: Record<string, Reading>;
  memory: Record<string, GoalProgress>;
  cues: { id: string; time: number; message: string; pause: boolean }[];
};
export type Trial = {
  number: number;
  scheduledPlan: RoutePlan;
  flightPlan: RoutePlan;
  appliedIds: string[];
  frames: FlightFrame[];
  plan: RoutePlan;
  status: Run['status'];
  reason: string;
  duration: number;
  trail: Run['trail'];
  evidence: EvidenceState;
};
export const emptyEvidence = (): EvidenceState => ({ readings: {}, memory: {}, cues: [] });
export function learningDesign(stage: Stage): LearningDesign {
  if (stage.learning) return stage.learning;
  const target = stage.bodies.find((b) => b.id === stage.launchBodyId)!;
  return {
    briefing:
      '같은 환경에서 실험합니다. 이전 발사를 복사하고 한 가지씩 바꾸면 어떤 조작이 결과를 바꿨는지 비교하기 쉽습니다.',
    cues: [],
    instruments: target
      ? [
          {
            id: 'height',
            label: '가장 멀리 올라간 높이',
            value: { kind: 'metric', metric: 'altitude', targetId: target.id },
            when: {
              kind: 'compare',
              left: { kind: 'metric', metric: 'time', targetId: '' },
              operator: 'gte',
              right: { kind: 'constant', value: 0 },
            },
            summary: 'max',
            range: {
              min: 0,
              max: stage.rules.worldRadius,
              below: '지면 아래',
              inside: '실제로 도달한 높이',
              above: '탐사 범위 밖',
            },
          },
        ]
      : [],
  };
}
export function collectEvidence(c: GoalContext) {
  const state = c.run.evidence;
  const design = learningDesign(c.stage);
  for (const device of design.instruments) {
    const p = (state.memory[device.id] ??= { complete: false, ratio: 0 });
    if (!evaluateCondition(device.when, c, p, 'when')) continue;
    const value = expressionValue(device.value, c, p, 'value');
    if (!Number.isFinite(value)) continue;
    const old = state.readings[device.id];
    if (
      !old ||
      device.summary === 'last' ||
      (device.summary === 'min' ? value < old.value : value > old.value)
    )
      state.readings[device.id] = { value, time: c.run.time, count: (old?.count ?? 0) + 1 };
    else old.count++;
  }
  for (const cue of design.cues) {
    if (state.cues.some((x) => x.id === cue.id)) continue;
    const p = (state.memory[cue.id] ??= { complete: false, ratio: 0 });
    if (evaluateCondition(cue.when, c, p)) state.cues.push({ ...cue, time: c.run.time });
  }
}
export function readingText(i: Instrument, r?: Reading): string {
  if (!r) return '아직 관측하지 못함';
  return r.value < i.range.min
    ? i.range.below
    : r.value > i.range.max
      ? i.range.above
      : i.range.inside;
}
export function recordTrial(run: Run, number: number): Trial {
  // Unexecuted future commands must not masquerade as experimental interventions.
  captureFrame(run, true);
  const plan = structuredClone(run.plan);
  plan.impulses = plan.impulses.filter((x) => run.applied.has(x.id));
  plan.engineCommands = plan.engineCommands?.filter((x) => run.applied.has(x.id));
  plan.deployments = plan.deployments?.filter((x) => run.applied.has(x.id));
  return {
    number,
    scheduledPlan: structuredClone(run.initialPlan ?? run.plan),
    flightPlan: structuredClone(run.plan),
    appliedIds: [...run.applied],
    frames: structuredClone(run.frames ?? []),
    plan,
    status: run.status,
    reason: run.reason,
    duration: run.time,
    trail: structuredClone(run.trail),
    evidence: structuredClone(run.evidence),
  };
}
export function compareTrials(a: Trial, b: Trial): string {
  const av = a.plan.launch,
    bv = b.plan.launch;
  const angle = Math.abs(Math.atan2(av.x * bv.y - av.y * bv.x, av.x * bv.x + av.y * bv.y));
  const commandValues = (p: RoutePlan) =>
    JSON.stringify([
      p.impulses.map(({ id: _, ...v }) => v),
      (p.engineCommands ?? []).map(({ id: _, ...v }) => v),
    ]);
  const sameCommands = commandValues(a.plan) === commandValues(b.plan);
  if (!sameCommands || angle > 0.015)
    return '방향이나 중간 조작도 달라졌습니다. 이 비교만으로 세기의 영향이라고 단정할 수 없습니다.';
  const diff = length(bv) - length(av);
  if (Math.abs(diff) < 0.00001)
    return '같은 조작의 반복입니다. 시간별 실제 경로를 겹쳐 결과가 재현되는지 확인하세요.';
  return `방향과 중간 조작은 같고 첫 추진만 ${diff > 0 ? '강해졌습니다' : '약해졌습니다'}. 같은 시각의 경로와 관측을 비교하세요. 비행 길이가 다르면 최대값의 직접 비교에는 주의하세요.`;
}
