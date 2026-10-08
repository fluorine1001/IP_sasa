import { gravity } from '../world/celestial';
import { length } from '../physics/vector';
import { seeded, auditStage } from './audit';
import { execute } from '../world/engine';
import { scaleConditions } from '../world/dimensions';
import {
  stageFingerprint,
  instantiateVariation,
  transformPlan,
  type VariationBank,
  type Variation,
} from '../world/variation';
import type { Stage } from '../world/types';
export type RandomizationReport = {
  tried: number;
  accepted: number;
  needed: number;
  done: boolean;
  reason: string;
  bank?: VariationBank;
};
/** Synthesize bounded, relational variants; accept only measured solvability and no proof replay between variants. */
export function* generateRandomization(stage: Stage): Generator<RandomizationReport> {
  const needed = Math.max(6, stage.rules.attempts),
    report: RandomizationReport = { tried: 0, accepted: 0, needed, done: false, reason: '' };
  let rotationSafe = true;
  try {
    for (const g of stage.goals) {
      const analysis = scaleConditions(g.condition, 1, 1);
      rotationSafe = rotationSafe && analysis.rotationSafe;
    }
  } catch (e) {
    report.done = true;
    report.reason = String(e);
    yield report;
    return;
  }
  if (needed > 24) {
    report.done = true;
    report.reason = '자동 변형은 최대 24개입니다. 발사 기회를 줄여주세요.';
    yield report;
    return;
  }
  const proofs = stage.referencePlans.filter((p) => execute(stage, p).status === 'won');
  if (!proofs.length) {
    report.done = true;
    report.reason =
      '먼저 실제 시험에서 클리어 경로를 저장하세요. 풀이가 확인되어야 자동 변형을 검증합니다.';
    yield report;
    return;
  }
  const random = seeded(stage.audit.seed ^ 0x13579),
    variants: Variation[] = [],
    worlds: Stage[] = [];
  let reuseChecks = 0,
    randomChecks = 0;
  for (let i = 0; i < 160 && variants.length < needed; i++) {
    report.tried++;
    if (i % 8 === 0) yield structuredClone(report);
    const spec: Variation = {
      id: i,
      lengthScale: 0.75 + random() * 0.6,
      timeScale: 0.7 + random() * 0.75,
      rotation: rotationSafe ? random() * Math.PI * 2 : 0,
      gravity: Object.fromEntries(
        stage.bodies
          .filter((b) => b.mu > 0)
          .map((b) => [b.id, 1 + (random() - 0.5) * (i % 3 === 0 ? 0 : i % 3 === 1 ? 0.05 : 0.34)]),
      ),
      proof: proofs[0],
    };
    // Compare actual measured fields, including all independently perturbed bodies.
    const candidate = instantiateVariation(stage, spec),
      reading = length(gravity(candidate, candidate.spawn.position, 0));
    if (
      reading < 1e-9 ||
      worlds.some(
        (w) => Math.abs(Math.log(reading / length(gravity(w, w.spawn.position, 0)))) < 0.12,
      )
    )
      continue;
    const transformed = proofs.map((p) => transformPlan(p, spec, !!stage.rocket));
    const proof = transformed.find((p) => execute(candidate, p).status === 'won');
    if (!proof) continue;
    spec.proof = proof;
    let reuse = false;
    for (const old of [...proofs, ...variants.map((v) => v.proof)]) {
      reuseChecks++;
      if (execute(candidate, old).status === 'won') {
        reuse = true;
        break;
      }
    }
    if (reuse) continue;
    for (const oldWorld of worlds) {
      reuseChecks++;
      if (execute(oldWorld, proof).status === 'won') {
        reuse = true;
        break;
      }
    }
    if (reuse) continue;
    candidate.referencePlans = [proof];
    candidate.audit.samples = 64;
    let audit;
    for (const step of auditStage(candidate)) audit = step;
    randomChecks += 64;
    if (!audit || audit.errors.length || audit.simpleWins.length || audit.randomWins > 0) continue;
    variants.push(spec);
    worlds.push(candidate);
    report.accepted = variants.length;
    yield structuredClone(report);
  }
  report.done = true;
  if (variants.length >= needed)
    report.bank = {
      version: 1,
      fingerprint: stageFingerprint(stage),
      variants,
      tried: report.tried,
      reuseChecks,
      randomChecks,
    };
  else
    report.reason =
      '검증된 변형 ' +
      variants.length +
      '/' +
      needed +
      '개. 목표가 너무 넓거나 단위 관계·기준 경로가 불안정합니다. 재사용 가능한 풀이가 남아 자동 적용하지 않았습니다.';
  yield report;
}
