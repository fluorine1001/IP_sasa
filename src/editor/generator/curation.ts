import { parseStage } from '../../stages/validation';
import { execute } from '../../world/engine';
import { assessDifficulty } from './assessment';
import { exploreMethods, type VerifiedMethod } from './solutions';
import type { Candidate } from './protocol';
import type { Stage } from '../../world/types';
import { missionFamily, missionMetrics } from './mission-facts';
import { auditGravity, type GravityAudit } from './gravity-audit';

export const curationPolicy = {
  version: 3,
  maxStep: 22,
  maxNewConcepts: 1,
  sameStructure: 2,
} as const;
const basic = new Set(['출력 설정', '방향 설정', '관성 비행']);
export type StageReview = {
  stage: Stage;
  fingerprint: string;
  geometryScore: number;
  score: number;
  style: string;
  methods: VerifiedMethod[];
  concepts: string[];
  eligible: boolean;
  reasons: string[];
  gravity?: GravityAudit;
};
export type Course = {
  entries: { review: StageReview; methodIndex: number; introduced: string[]; reason: string }[];
  held: { review: StageReview; reason: string }[];
  requested: number;
};

export function reviewStage(
  stage: Stage,
  fingerprint: string,
  geometryScore: number,
  style: string,
  methods: VerifiedMethod[],
  gravity?: GravityAudit,
): StageReview {
  const coarse = methods.filter((m) => m.coarse),
    kinds = new Set(coarse.map((m) => m.kind));
  const margin = (m: VerifiedMethod) => m.nearbyWins / Math.max(1, m.nearbyTotal);
  const scores = coarse.map(
    (m) =>
      geometryScore * 0.55 +
      (1 - margin(m)) * 24 +
      Math.min(10, m.actions) * 2 +
      m.skills.filter((s) => !basic.has(s)).length * 4 -
      Math.min(2, kinds.size - 1) * 2,
  );
  const reasons: string[] = [];
  if (kinds.size < 2) reasons.push('서로 다른 둥근 수치의 풀이 방식 2개가 아직 없습니다.');
  if (!coarse.some((m) => margin(m) >= 0.25))
    reasons.push('둥근 수치 풀이의 조작 여유가 부족합니다.');
  if (!stage.launchBodyId || stage.rocket?.parts.length !== 1)
    reasons.push('현재 자동 선별 범위인 단일 추진단 표면 발사가 아닙니다.');
  const metrics = [...missionMetrics(stage)],
    family = missionFamily(stage);
  if (
    stage.goalMode !== 'all' ||
    stage.objects.some((o) => !['sensor', 'landing-site'].includes(o.kind) || o.dynamic) ||
    metrics.some(
      (m) =>
        ![
          'x',
          'y',
          'vx',
          'vy',
          'throttle',
          'altitude',
          'distance',
          'energy',
          'radialSpeed',
          'orbitTurns',
          'landed',
          'touchdownSpeed',
          'touchdownNormalSpeed',
          'touchdownTangentialSpeed',
          'touchdownTilt',
          'propellantUsed',
          'time',
          'ignitions',
          'angularMomentum',
          'thrustUsed',
        ].includes(m),
    )
  )
    reasons.push(
      '현재 자동 순서 제안의 관측·착륙·궤도·탈출·중력 도움·자유 귀환 범위를 벗어납니다. 직접 검토하세요.',
    );
  const concepts = [
    ...(family === 'gravity-assist'
      ? ['중력 도움']
      : family === 'free-return'
        ? ['자유 귀환']
        : family === 'landing'
          ? ['안전 착륙']
          : family === 'orbit'
            ? ['궤도 유지']
            : family === 'escape'
              ? ['중력권 탈출']
              : []),
    ...(stage.objects.filter((o) => o.kind === 'sensor').length > 1 ? ['연속 관측'] : []),
    ...(style === '옆으로 휘는 호'
      ? ['휘어진 경로']
      : style === '행성을 감싸는 호'
        ? ['휘어진 경로', '긴 우회']
        : []),
  ];
  if (gravity && !gravity.passed)
    reasons.push('추가 천체의 중력 기여와 경로 변화를 더 확인해야 합니다.');
  return {
    stage,
    fingerprint,
    geometryScore,
    style,
    methods,
    score: Math.round(
      Math.min(100, Math.max(0, scores.length ? Math.min(...scores) : geometryScore + 20)),
    ),
    concepts,
    eligible: !reasons.length,
    reasons,
    gravity,
  };
}
export function reviewCandidate(candidate: Candidate): StageReview {
  return reviewStage(
    candidate.stage,
    candidate.fingerprint,
    candidate.assessment.score,
    candidate.assessment.style,
    candidate.methods,
    candidate.gravity,
  );
}
function required(review: StageReview, method: VerifiedMethod) {
  return [...new Set([...review.concepts, ...method.skills.filter((s) => !basic.has(s))])];
}
function structure(review: StageReview) {
  return `${missionFamily(review.stage)}/${review.style}/${review.stage.objects.filter((o) => o.kind === 'sensor').length}`;
}

/** A partial course is preferable to inventing an introductory stage or crossing a large gap. */
export function selectCourse(reviews: StageReview[], requested = 6): Course {
  requested = Math.max(1, Math.min(12, Math.round(requested)));
  const sorted = [...reviews].sort(
    (a, b) => a.score - b.score || a.fingerprint.localeCompare(b.fingerprint),
  );
  const entries: Course['entries'] = [],
    learned = new Set<string>(),
    used = new Set<string>(),
    patterns = new Map<string, number>();
  while (entries.length < requested) {
    const previous = entries.at(-1)?.review.score;
    let choice:
      { review: StageReview; index: number; introduced: string[]; rank: number } | undefined;
    for (const review of sorted) {
      if (
        !review.eligible ||
        used.has(review.fingerprint) ||
        (patterns.get(structure(review)) ?? 0) >= curationPolicy.sameStructure
      )
        continue;
      if (
        previous !== undefined &&
        (review.score < previous || review.score - previous > curationPolicy.maxStep)
      )
        continue;
      for (const [index, method] of review.methods.entries()) {
        if (
          !method.coarse ||
          method.nearbyWins / Math.max(1, method.nearbyTotal) < (entries.length ? 0.25 : 0.5)
        )
          continue;
        const introduced = required(review, method).filter((s) => !learned.has(s));
        if (introduced.length > (entries.length ? curationPolicy.maxNewConcepts : 0)) continue;
        const after = new Set([...learned, ...introduced]);
        const unlocks = sorted.filter(
          (next) =>
            next.eligible &&
            next.score >= review.score &&
            next !== review &&
            !used.has(next.fingerprint) &&
            !next.methods.some(
              (m) =>
                m.coarse &&
                m.nearbyWins / Math.max(1, m.nearbyTotal) >= 0.25 &&
                required(next, m).filter((s) => !learned.has(s)).length <= 1,
            ) &&
            next.methods.some(
              (m) =>
                m.coarse &&
                m.nearbyWins / Math.max(1, m.nearbyTotal) >= 0.25 &&
                required(next, m).filter((s) => !after.has(s)).length <= 1,
            ),
        ).length;
        const rank =
          review.score +
          introduced.length * 0.25 -
          (method.nearbyWins / Math.max(1, method.nearbyTotal)) * 3 -
          Math.min(3, unlocks) * 1.5;
        if (!choice || rank < choice.rank) choice = { review, index, introduced, rank };
      }
    }
    if (!choice) break;
    const { review, index, introduced } = choice;
    entries.push({
      review,
      methodIndex: index,
      introduced,
      reason: !entries.length
        ? '새 개념 없이 시작하고 조작 변경의 절반 이상이 성공한 입문 후보입니다.'
        : `${entries.at(-1)!.review.score} → ${review.score}점 · ${introduced.length ? '새 개념: ' + introduced.join(', ') : '배운 개념을 다른 배치에서 연습'}`,
    });
    used.add(review.fingerprint);
    required(review, review.methods[index]).forEach((s) => learned.add(s));
    patterns.set(structure(review), (patterns.get(structure(review)) ?? 0) + 1);
  }
  const held = sorted
    .filter((r) => !used.has(r.fingerprint))
    .map((review) => ({
      review,
      reason: !review.eligible
        ? review.reasons.join(' ')
        : !entries.length
          ? '입문용 기초 후보가 먼저 필요합니다.'
          : (patterns.get(structure(review)) ?? 0) >= curationPolicy.sameStructure
            ? '비슷한 구조는 두 개까지 먼저 선별합니다.'
            : review.score < entries.at(-1)!.review.score
              ? '이번 순서에서 앞 단계와 겹쳐 보류했습니다.'
              : review.score - entries.at(-1)!.review.score > curationPolicy.maxStep
                ? '앞 단계와의 난도 차이가 큽니다. 중간 후보가 필요합니다.'
                : '새 개념이나 조작 여유를 더 검토해야 합니다.',
    }));
  return { entries, held, requested };
}

export function coursePackage(course: Course) {
  if (!course.entries.length) throw Error('내보낼 선별 스테이지가 없습니다.');
  const stages: Record<string, Stage> = {};
  for (const [index, entry] of course.entries.entries()) {
    const stage = parseStage(structuredClone(entry.review.stage));
    stage.order = index + 1;
    stage.published = false;
    stages[stage.id] = stage;
  }
  return {
    version: 1,
    kind: 'workshop-course',
    id: crypto.randomUUID(),
    criteriaVersion: curationPolicy.version,
    requestedCount: course.requested,
    complete: course.entries.length === course.requested,
    orderedStageIds: course.entries.map((e) => e.review.stage.id),
    stages,
    rationale: Object.fromEntries(
      course.entries.map((e) => [
        e.review.stage.id,
        { score: e.review.score, reason: e.reason, introduced: e.introduced },
      ]),
    ),
  };
}
export function readStagePackage(value: unknown): Stage[] {
  if (!value || typeof value !== 'object') throw Error('스테이지 JSON 형식을 확인하세요.');
  const data = value as Record<string, unknown>;
  const values =
    data.version === 2
      ? [data]
      : (data.kind === 'workshop-course' || data.kind === 'workshop-candidate-pool') &&
          data.version === 1 &&
          data.stages &&
          typeof data.stages === 'object' &&
          !Array.isArray(data.stages)
        ? Object.values(data.stages)
        : [];
  if (!values.length || values.length > 48)
    throw Error('스테이지 또는 48개 이하의 순서 묶음을 선택하세요.');
  const stages = values.map((v) => parseStage(v));
  if (
    data.version === 1 &&
    data.stages &&
    stages.some((s, i) => Object.keys(data.stages as object)[i] !== s.id)
  )
    throw Error('묶음의 키와 스테이지 ID가 다릅니다.');
  if (new Set(stages.map((s) => s.id)).size !== stages.length)
    throw Error('중복 스테이지 ID가 있습니다.');
  return stages;
}
export function poolPackage(reviews: StageReview[]) {
  return {
    version: 1,
    kind: 'workshop-candidate-pool',
    id: crypto.randomUUID(),
    stages: Object.fromEntries(
      reviews.map((r) => {
        const stage = parseStage(structuredClone(r.stage));
        stage.published = false;
        return [stage.id, stage];
      }),
    ),
  };
}

/** Imported metadata is ignored: plans and geometry are checked again against the current snapshot. */
export function* analyzeImportedStage(
  stage: Stage,
): Generator<{ checked: number; review?: StageReview }> {
  let checked = 0,
    methods: VerifiedMethod[] = [];
  for (const step of exploreMethods(stage, stage.referencePlans, 160)) {
    checked = step.checked;
    methods = step.methods;
    yield { checked };
  }
  let geometryScore = 100,
    style = '검토 필요';
  if (
    methods.length &&
    stage.bodies.length &&
    stage.launchBodyId &&
    stage.rocket?.parts.length === 1
  ) {
    const body = stage.bodies.find((b) => b.id === stage.launchBodyId)!;
    const orderedStage = { ...stage, bodies: [body, ...stage.bodies.filter((b) => b !== body)] };
    const targetRadius = Math.max(
      1,
      ...stage.objects.map(
        (o) =>
          Math.hypot(o.position.x - body.position.x, o.position.y - body.position.y) / body.radius,
      ),
    );
    checked++;
    const run = execute(stage, methods[0].plan, true);
    const assessment = assessDifficulty(
      orderedStage,
      { launchAngle: stage.launchAngle ?? 0, targetRadius },
      run,
      methods[0].nearbyWins,
      methods[0].nearbyTotal,
    );
    geometryScore = assessment.score;
    style = assessment.style;
  }
  const gravity =
    methods.length && stage.launchBodyId ? auditGravity(stage, methods[0].plan) : undefined;
  checked += gravity?.checked ?? 0;
  yield {
    checked,
    review: reviewStage(stage, `import/${stage.id}`, geometryScore, style, methods, gravity),
  };
}
