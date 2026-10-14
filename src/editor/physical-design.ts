import { newObject } from '../stages/factory';
import { bodyPosition, bodyVelocity } from '../world/celestial';
import { add, sub, length, scale, unit, type Vec } from '../physics/vector';
import type { Stage, Body, WorldObject } from '../world/types';

export function orbitInitialState(
  stage: Stage,
  body: Body,
  position: Vec,
  eccentricity = 0,
  clockwise = false,
) {
  if (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity > 5)
    throw Error('궤도 찌그러짐은 0~5입니다.');
  const radial = sub(position, bodyPosition(stage, body, 0)),
    radius = length(radial);
  if (radius <= body.radius) throw Error('출발점은 기준 천체의 표면 밖이어야 합니다.');
  const normal = unit(radial),
    speed = Math.sqrt((body.mu * (1 + eccentricity)) / radius);
  return {
    position: { ...position },
    velocity: add(
      bodyVelocity(stage, body, 0),
      scale({ x: -normal.y, y: normal.x }, speed * (clockwise ? -1 : 1)),
    ),
  };
}
/** Deterministic orbital debris, not a lethal abstract area. Each solid has its own motion. */
export function asteroidBelt(
  stage: Stage,
  body: Body,
  inner: number,
  outer: number,
  count: number,
  radius: number,
): WorldObject[] {
  if (
    ![inner, outer, count, radius].every(Number.isFinite) ||
    inner <= body.radius ||
    outer < inner ||
    count < 1 ||
    count > 128 ||
    !Number.isInteger(count) ||
    radius <= 0 ||
    radius > (outer - body.radius) / 4
  )
    throw Error('소행성 띠의 반경·개수·크기를 확인하세요.');
  const center = bodyPosition(stage, body, 0);
  return Array.from({ length: count }, (_, i) => {
    const angle = i * 2.399963229728653,
      distance = inner + (outer - inner) * ((i * 0.61803398875) % 1);
    const position = add(center, { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance });
    const o = newObject('debris');
    return {
      ...o,
      name: `소행성 ${i + 1}`,
      radius,
      position,
      dynamic: { velocity: orbitInitialState(stage, body, position).velocity },
    };
  });
}
export function physicalDesignIssues(stage: Stage): string[] {
  const result: string[] = [];
  if (stage.objects.some((o) => ['gate', 'hazard', 'path'].includes(o.kind)))
    result.push(
      '구형 게이트·즉시 실패 영역·강제 경로를 물리 상태 목표 또는 실제 파편으로 교체하고 삭제하세요.',
    );
  if (!stage.rocket) result.push('공개 임무에는 연료·추력이 있는 로켓을 구성하세요.');
  if (stage.objects.some((o) => o.kind === 'station' && !o.physicalRadius))
    result.push('구형 관측 목표의 실제 물체 크기를 지정하세요.');
  return result;
}
