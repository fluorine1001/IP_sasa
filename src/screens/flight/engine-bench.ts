import type { Stage, RoutePlan } from '../../world/types';
import { escape } from '../../app/core';
import { launchFraction } from '../../world/program';
/** Static hardware illustration: no environment simulation or predicted flight. */
export function engineBench(stage: Stage, plan: RoutePlan, commandId = 'launch') {
  if (!stage.rocket) {
    const impulse = plan.impulses.find((command) => command.id === commandId);
    const power = Math.min(
      1,
      Math.hypot((impulse?.vector ?? plan.launch).x, (impulse?.vector ?? plan.launch).y) /
        Math.max(1e-9, impulse ? stage.rules.maneuverBudget : stage.rules.launchLimit),
    );
    return `<figure class="engine-bench" data-throttle="${power}" aria-label="순간 추진 크기 비교 그림"><svg viewBox="0 0 270 100" role="img" aria-label="추진 크기에 비례하는 불꽃과 속도 변화 화살표"><path d="M18 52h232" stroke="#48656c" stroke-dasharray="3 7"/><path d="M107 42h50l14 10-14 10h-50z" fill="#e6d8b6" stroke="#0b1723" stroke-width="2"/>${power > 0 ? `<path d="M106 45L${106 - (12 + 70 * power)} 52 106 59Z" fill="#eba94e"/><path d="M174 52h${84 * power}" stroke="#9ed2b0" stroke-width="5"/><path d="M${174 + 84 * power - 7} 46l8 6-8 6" fill="none" stroke="#9ed2b0" stroke-width="3"/>` : ''}<text x="15" y="87" fill="#b7c9be">0</text><text x="233" y="87" fill="#b7c9be">100%</text></svg><figcaption><span>순간 추진 장치</span><span>➜ 속도 변화</span></figcaption></figure>`;
  }
  const commands = [...(plan.engineCommands ?? [])].sort((a, b) => a.time - b.time);
  const selected = commands.find((c) => c.id === commandId);
  let index = 0;
  for (const c of commands) {
    if (c.id === commandId) break;
    if (c.actorId === 'craft' && c.separate) index++;
  }
  if (commandId === 'launch') index = 0;
  if (selected && selected.actorId !== 'craft')
    index = stage.rocket.parts.findIndex((p) => p.id === selected.actorId);
  const part = stage.rocket.parts[index];
  if (!part) return '';
  const throttle = Math.max(0, Math.min(1, selected?.throttle ?? launchFraction(stage, plan)));
  const force = part.thrust * throttle,
    flow = force / part.exhaustSpeed;
  const maxForce = Math.max(...stage.rocket.parts.map((p) => p.thrust));
  const maxFlow = Math.max(...stage.rocket.parts.map((p) => p.thrust / p.exhaustSpeed));
  const flame = 12 + throttle * 70,
    arrow = (84 * force) / maxForce;
  return `<figure class="engine-bench" data-throttle="${throttle}" aria-label="${escape(part.name)} 출력 비교 그림"><svg viewBox="0 0 270 100" role="img" aria-label="출력에 비례하는 불꽃과 힘, 연료 흐름"><path d="M18 52h232" stroke="#48656c" stroke-dasharray="3 7"/><path d="M107 42h50l14 10-14 10h-50z" fill="#e6d8b6" stroke="#0b1723" stroke-width="2"/><rect x="106" y="46" width="7" height="12" fill="#749aa0"/>${throttle > 0 ? `<path class="bench-flame" d="M106 45Q${106 - flame} 44 ${106 - flame} 52Q${106 - flame} 60 106 59Z" fill="#eba94e"/><path d="M106 48L${106 - flame * 0.6} 52 106 56Z" fill="#fff0b4"/>` : ''}<path d="M174 52h${arrow}" stroke="#9ed2b0" stroke-width="5"/>${arrow > 0 ? `<path d="M${174 + arrow - 7} 46l8 6-8 6" fill="none" stroke="#9ed2b0" stroke-width="3"/>` : ''}<rect x="105" y="12" width="52" height="13" rx="3" fill="#16323c" stroke="#789b8d"/><rect x="108" y="15" width="46" height="7" fill="#8dc5af"/><path d="M131 25v12" stroke="#8dc5af" stroke-width="2"/>${flow > 0 ? `<circle class="bench-flow" cx="131" cy="28" r="2" fill="#f2d38d" style="--flow-duration:${1.8 - (1.4 * flow) / maxFlow}s"/>` : ''}<text x="15" y="87" fill="#b7c9be">0</text><text x="233" y="87" fill="#b7c9be">100%</text></svg><figcaption><span>${escape(part.name)}</span><span>➜ 힘 · ◉ 연료 흐름</span></figcaption></figure>`;
}

export function actorDiagram(stage: Stage, actorId: string, firstPart = 0) {
  if (!stage.rocket)
    return '<figure class="actor-diagram"><svg viewBox="0 0 130 52" role="img" aria-label="본체 하나"><rect x="25" y="13" width="64" height="24" rx="4" fill="#d8b879"/><path d="M89 13l22 12-22 12z" fill="#d8b879"/></svg><figcaption>본체</figcaption></figure>';
  const parts = stage.rocket.parts;
  return `<figure class="actor-diagram"><svg viewBox="0 0 ${55 + parts.length * 50} 52" role="img" aria-label="${actorId === 'craft' ? '본체' : '분리된 단'}">${parts.map((p, i) => `<rect x="${25 + i * 50}" y="13" width="44" height="24" rx="4" fill="${(actorId === 'craft' && i >= firstPart) || actorId === p.id ? '#d8b879' : '#29424b'}" stroke="#a8bfb2"/><text x="${47 + i * 50}" y="30" text-anchor="middle" fill="#102530">${i + 1}</text>`).join('')}<path d="M${25 + parts.length * 50} 13l22 12-22 12z" fill="${actorId === 'craft' ? '#d8b879' : '#29424b'}"/></svg><figcaption>${actorId === 'craft' ? '본체' : escape(parts.find((p) => p.id === actorId)?.name ?? '분리된 단')}</figcaption></figure>`;
}

/** Same up/right axes as the world map, not a second rotated coordinate convention. */
export const dialRotation = (degrees: number, baseAngle = 0) =>
  90 - degrees - (baseAngle * 180) / Math.PI;
export function dialAngle(x: number, y: number, baseAngle = 0) {
  const a = Math.atan2(-y, x) - baseAngle;
  const result = (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI;
  return result === 0 ? 0 : result;
}
export function directionDial(degrees: number, baseAngle = 0) {
  const label = (offset: number, text: string) => {
    const a = baseAngle + (offset * Math.PI) / 180;
    return `<text x="${90 + 75 * Math.cos(a)}" y="${94 - 75 * Math.sin(a)}" text-anchor="middle">${text}</text>`;
  };
  return `<div class="direction-dial" role="group" aria-label="지도와 같은 방향"><svg viewBox="0 0 180 180" role="img" aria-label="지도와 같은 방향으로 기체 자세 선택"><circle cx="90" cy="90" r="64" fill="#102631" stroke="#658b8c"/><path d="M90 20v140M20 90h140" stroke="#496b6f" stroke-dasharray="3 6"/>${label(0, '바깥')}${label(90, '왼쪽')}${label(-90, '오른쪽')}${label(180, '행성 쪽')}<g class="dial-pointer" transform="rotate(${dialRotation(degrees, baseAngle)} 90 90)"><path d="M90 92V35" stroke="#edc47d" stroke-width="5"/><path d="M83 45l7-14 7 14" fill="#edc47d"/></g><circle cx="90" cy="90" r="6" fill="#b1cdbf"/></svg></div>`;
}
