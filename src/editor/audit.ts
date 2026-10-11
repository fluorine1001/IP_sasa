import { learningDesign, readingText } from '../world/evidence';
import { bodyPosition } from '../world/celestial.ts';
import type { Stage, RoutePlan } from '../world/types.ts';
import { execute } from '../world/engine.ts';
import { issues } from '../stages/validation.ts';
import { length, scale, unit, sub } from '../physics/vector.ts';
export type AuditResult = {
  feedback?: { nearbyWins: number; nearbyTotal: number; distinctReports: number };
  checked: number;
  total: number;
  randomWins: number;
  simpleWins: string[];
  referenceWins: number;
  warnings: string[];
  errors: string[];
  counterexamples: { label: string; plan: RoutePlan }[];
  done: boolean;
};
export function seeded(seed: number) {
  let value = seed | 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
export function* auditStage(stage: Stage): Generator<AuditResult> {
  const result: AuditResult = {
    checked: 0,
    total: Math.max(16, Math.min(2048, stage.audit.samples)),
    randomWins: 0,
    simpleWins: [],
    referenceWins: 0,
    warnings: [],
    errors: issues(stage),
    counterexamples: [],
    done: false,
  };
  if (result.errors.length) {
    result.done = true;
    yield result;
    return;
  }
  for (const p of stage.referencePlans)
    if (execute(stage, p).status === 'won') result.referenceWins++;
  if (!result.referenceWins)
    result.warnings.push('클리어 가능한 기준 경로가 없습니다. 직접 시험해 성공 경로를 저장하세요.');
  if (stage.goalMode === 'any' && stage.goals.length > 1)
    result.warnings.push('목표 중 하나만 달성해도 성공합니다. 의도한 조건인지 확인하세요.');
  const limit = stage.rules.launchLimit,
    base = stage.spawn.velocity,
    nearest = stage.bodies.reduce((a, b) =>
      length(sub(bodyPosition(stage, a, 0), stage.spawn.position)) <
      length(sub(bodyPosition(stage, b, 0), stage.spawn.position))
        ? a
        : b,
    ),
    toward = unit(sub(bodyPosition(stage, nearest, 0), stage.spawn.position));
  const simple: [string, RoutePlan][] = [
    ['무추진', { launch: { x: 0, y: 0 }, impulses: [] }],
    [
      '최대 순방향 추진',
      { launch: scale(length(base) ? unit(base) : { x: 0, y: 1 }, limit), impulses: [] },
    ],
    [
      '최대 역방향 추진',
      { launch: scale(length(base) ? unit(base) : { x: 0, y: 1 }, -limit), impulses: [] },
    ],
    ['천체를 향해 직진', { launch: scale(toward, limit), impulses: [] }],
    ['천체에서 멀어지기', { launch: scale(toward, -limit), impulses: [] }],
  ];
  for (const [label, plan] of simple)
    if (execute(stage, plan).status === 'won') {
      result.simpleWins.push(label);
      result.counterexamples.push({ label, plan });
    }
  if (result.simpleWins.length)
    result.warnings.push(
      `단순 전략으로 성공: ${result.simpleWins.join(', ')}. 입문 임무라면 허용하고 고급 퍼즐에서는 조건을 조정하세요.`,
    );
  if (stage.learning) {
    const design = learningDesign(stage),
      reports = new Set<string>();
    let nearbyWins = 0,
      nearbyTotal = 0;
    const reference = stage.referencePlans.find((p) => execute(stage, p).status === 'won');
    if (reference) {
      for (const factor of [0.98, 1, 1.02])
        for (const timeShift of [-0.15, 0, 0.15]) {
          const p = structuredClone(reference);
          p.launch = scale(p.launch, factor);
          p.impulses.forEach((b) => (b.time = Math.max(0, b.time + timeShift)));
          if (length(p.launch) > stage.rules.launchLimit) continue;
          nearbyTotal++;
          if (execute(stage, p).status === 'won') nearbyWins++;
        }
      for (const factor of [0.8, 0.9, 1, 1.1]) {
        const p = structuredClone(reference);
        p.launch = scale(
          p.launch,
          Math.min(factor, stage.rules.launchLimit / Math.max(length(p.launch), 1e-9)),
        );
        p.impulses = [];
        const r = execute(stage, p, true);
        reports.add(
          design.instruments.map((i) => readingText(i, r.evidence.readings[i.id])).join(' / '),
        );
      }
    }
    result.feedback = { nearbyWins, nearbyTotal, distinctReports: reports.size };
    if (nearbyTotal && nearbyWins <= 1)
      result.warnings.push(
        '기준 풀이 근처의 작은 세기·시각 차이도 대부분 실패합니다. 손으로 조작 가능한 허용 범위를 확인하세요.',
      );
    if (reports.size < 2)
      result.warnings.push(
        '서로 다른 첫 추진의 관측 안내가 구분되지 않습니다. 실패의 원인을 좁힐 단서를 추가하세요.',
      );
  }
  yield structuredClone(result);
  const random = seeded(stage.audit.seed || 1);
  for (let i = 0; i < result.total; i++) {
    const angle = random() * 2 * Math.PI,
      amount = Math.sqrt(random()) * limit,
      plan: RoutePlan = {
        launch: { x: Math.cos(angle) * amount, y: Math.sin(angle) * amount },
        impulses: [],
      };
    if (i % 3 === 0 && stage.rules.maneuverBudget > 0) {
      const a = random() * 2 * Math.PI,
        m = random() * stage.rules.maneuverBudget;
      plan.impulses.push({
        id: `audit-${i}`,
        time: random() * stage.rules.maxTime,
        vector: { x: Math.cos(a) * m, y: Math.sin(a) * m },
      });
    }
    if (stage.rocket && i % 2 === 0) {
      plan.engineCommands = [];
      let time = 0;
      for (let j = 0; j < stage.rocket.parts.length * 3; j++) {
        time += random() * Math.min(stage.rules.maxTime / (stage.rocket.parts.length * 3), 4);
        const a = random() * Math.PI * 2;
        plan.engineCommands.push({
          id: `engine-${i}-${j}`,
          time,
          actorId: 'craft',
          throttle: random(),
          direction: { x: Math.cos(a), y: Math.sin(a) },
        });
        if (j % 3 === 2)
          plan.engineCommands.push({
            id: `sep-${i}-${j}`,
            time: time + 0.01,
            actorId: 'craft',
            separate: true,
          });
      }
    }
    if (execute(stage, plan).status === 'won') {
      result.randomWins++;
      if (result.counterexamples.length < 8)
        result.counterexamples.push({ label: `임의 경로 ${i + 1}`, plan });
    }
    result.checked++;
    if (i % 8 === 7) yield structuredClone(result);
  }
  if (result.randomWins / result.total > stage.audit.maxPassRate)
    result.warnings.push(
      '임의 발사 성공률이 설계 기준보다 높습니다. 허용 영역·속력·유지 시간·추진 예산을 좁혀 다시 시험하세요.',
    );
  result.done = true;
  yield structuredClone(result);
}
