/* Mission briefing: everything a player needs before the first launch, on one sheet.
 * Goals in plain words, how medals are earned, the given physical data for every body
 * and stage of the craft, and the controls this mission allows. Numbers derive from the
 * stage itself; bodies whose gravity is hidden stay hidden (measuring them is the puzzle). */
import { escape, readSaved, writeSaved } from '../../app/core';
import type { Stage } from '../../world/types';
import { bodyFacts } from '../../world/conic';
import { bodyPosition, bodyVelocity } from '../../world/celestial';
import { commandNames, type CommandKind } from '../../world/program';
import { missionGoalsHtml } from './goal-guide';
import { controlIcon } from './controls';
import { bodyDisc, medalBadge, meter, pips, rocketSide, stageFill } from '../../ui/figures';

const f = (n: number, digits = 2) =>
  !Number.isFinite(n)
    ? '—'
    : Math.abs(n) >= 100
      ? n.toFixed(0)
      : Math.abs(n) >= 10
        ? n.toFixed(1)
        : n.toFixed(digits);

/** Per-stage numbers of the rocket: what each stage can do on its own. */
export function stageTable(stage: Stage) {
  const r = stage.rocket;
  if (!r) return [];
  const payload = r.payloadMass + (r.payloads ?? []).reduce((m, p) => m + p.mass, 0);
  return r.parts.map((p, i) => {
    const above = r.parts.slice(i + 1).reduce((m, q) => m + q.dryMass + q.fuelMass, 0) + payload;
    const m0 = p.dryMass + p.fuelMass + above;
    const m1 = p.dryMass + above;
    const flow = p.thrust / Math.max(1e-9, p.exhaustSpeed);
    return {
      name: p.name,
      mass: m0,
      thrust: p.thrust,
      burn: p.fuelMass / Math.max(1e-9, flow),
      deltaV: p.exhaustSpeed * Math.log(m0 / m1),
      ignitions: p.ignitionLimit,
      accel: p.thrust / m0,
    };
  });
}

function bodiesHtml(stage: Stage) {
  const maxRadius = Math.max(
    ...stage.bodies.filter((b) => b.kind !== 'barycenter').map((b) => b.radius),
    1e-9,
  );
  const rows = stage.bodies
    .filter((b) => b.kind !== 'barycenter')
    .map((b) => {
      const facts = bodyFacts(b);
      const hidden = b.hiddenGravity;
      let motion = '고정';
      if (b.motion) {
        const parent = stage.bodies.find((p) => p.id === b.motion!.parentId);
        const rel = parent
          ? Math.hypot(
              bodyVelocity(stage, b, 0).x - bodyVelocity(stage, parent, 0).x,
              bodyVelocity(stage, b, 0).y - bodyVelocity(stage, parent, 0).y,
            )
          : 0;
        motion =
          rel > 1e-9
            ? `${escape(parent?.name ?? '')} 둘레 ${f((2 * Math.PI * b.motion.radius) / rel, 1)}초에 한 바퀴`
            : '고정';
      } else if (b.dynamic) motion = '서로 끌어당기며 움직임';
      const air =
        b.atmosphere && b.atmosphere.density > 0 ? `높이 ${f(b.atmosphere.height)} u` : '없음';
      const q = (v: number) => (hidden ? '<span class="dim">관측 필요</span>' : f(v, 3));
      const row = `<tr><th scope="row"><i class="swatch" style="--swatch:${escape(b.color)}"></i>${escape(b.name)}</th><td class="num">${f(b.radius)}</td><td class="num">${q(facts.surfaceGravity)}</td><td class="num">${q(facts.surfaceOrbitSpeed)}</td><td class="num">${q(facts.escapeSpeed)}</td><td>${air}</td><td>${motion}</td></tr>`;
      const v = (label: string, value: string, unit: string) =>
        `<div><span>${label}</span><b>${value}${hidden ? '' : `<small>${unit}</small>`}</b></div>`;
      const card = `<li class="body-card">${bodyDisc(b.color, b.radius / maxRadius, b.atmosphere && b.atmosphere.density > 0 ? b.atmosphere.height / Math.max(b.radius, 1e-9) : 0, 64)}<div class="body-card-text"><b class="body-name">${escape(b.name)}</b><small>${motion}</small><div class="body-facts">${v('반지름', f(b.radius), 'u')}${v('원궤도 속력', q(facts.surfaceOrbitSpeed), 'u/s')}${v('탈출 속력', q(facts.escapeSpeed), 'u/s')}${b.atmosphere && b.atmosphere.density > 0 ? v('대기', f(b.atmosphere.height), 'u') : ''}</div></div></li>`;
      return { row, card };
    });
  return `<ul class="body-cards">${rows.map((r) => r.card).join('')}</ul><details class="briefing-numbers"><summary>숫자로 보기</summary><table class="ui-table briefing-table"><thead><tr><th>천체</th><th class="num">반지름 u</th><th class="num">표면 중력 u/s²</th><th class="num">표면 원궤도 속력 u/s</th><th class="num">탈출 속력 u/s</th><th>대기</th><th>움직임</th></tr></thead><tbody>${rows.map((r) => r.row).join('')}</tbody></table></details>`;
}

function craftHtml(stage: Stage) {
  if (!stage.rocket) {
    const launchBody = stage.bodies.find((b) => b.id === stage.launchBodyId);
    const start = stage.spawn.position;
    const alt = launchBody
      ? Math.hypot(
          start.x - bodyPosition(stage, launchBody, 0).x,
          start.y - bodyPosition(stage, launchBody, 0).y,
        ) - launchBody.radius
      : undefined;
    return `<div class="briefing-stats">${[
      stage.rules.launchLimit > 0
        ? ['발사 추진 최대', f(stage.rules.launchLimit, 3), 'u/s']
        : undefined,
      stage.rules.maneuverBudget > 0
        ? ['수정 추진 총량', f(stage.rules.maneuverBudget, 3), 'u/s']
        : undefined,
      alt !== undefined ? ['출발 고도', f(Math.max(0, alt)), 'u'] : undefined,
      ['시작 속력', f(Math.hypot(stage.spawn.velocity.x, stage.spawn.velocity.y), 3), 'u/s'],
    ]
      .filter((x): x is string[] => !!x)
      .map(
        ([l, v, u]) => `<div class="ui-stat"><span>${l}</span><b>${v}<small>${u}</small></b></div>`,
      )
      .join('')}</div>`;
  }
  const rows = stageTable(stage);
  const launchBody = stage.bodies.find((b) => b.id === stage.launchBodyId) ?? stage.bodies[0];
  const g =
    launchBody && !launchBody.hiddenGravity ? bodyFacts(launchBody).surfaceGravity : undefined;
  const total = rows.reduce((s, r) => s + r.deltaV, 0);
  const r = stage.rocket;
  const sizes = r.parts.map((p) => ({ size: p.dryMass + p.fuelMass }));
  const maxBurn = Math.max(...rows.map((x) => x.burn), 1e-9);
  const maxAccel = Math.max(...rows.map((x) => x.accel), 1e-9);
  const maxTwr = g ? Math.max(2, ...rows.map((x) => x.accel / g)) * 1.1 : 0;
  // The whole craft, then one row per stage: Δv share, burn time, lift-off margin, relights.
  const budget = `<div class="craft-budget" role="img" aria-label="전체 Δv ${f(total, 3)} u/s">${rows
    .map(
      (x, i) =>
        `<i style="flex:${x.deltaV};background:${stageFill(i)}" title="${escape(x.name)} ${f(x.deltaV, 3)} u/s"></i>`,
    )
    .join('')}</div>`;
  const stageRows = rows
    .map((x, i) => {
      const twr = g ? x.accel / g : undefined;
      return `<li class="craft-stage"><div class="craft-stage-name"><i style="background:${stageFill(i)}"></i><b>${escape(x.name)}</b></div>
<div class="craft-cell"><span>Δv</span><b>${f(x.deltaV, 3)}<small>u/s</small></b>${meter(x.deltaV, total, { fill: stageFill(i), label: 'Δv' })}</div>
<div class="craft-cell"><span>연소 시간</span><b>${f(x.burn, 1)}<small>초</small></b>${meter(x.burn, maxBurn, { tone: 'neutral', label: '연소 시간' })}</div>
${
  twr !== undefined && i === 0
    ? `<div class="craft-cell"><span>이륙 추력 대 무게</span><b class="${twr < 1 ? 'low' : ''}">${f(twr, 2)}<small>배</small></b>${meter(twr, maxTwr, { tone: twr < 1 ? 'bad' : 'ok', marks: [{ at: 1, label: '1배 = 뜸' }], label: '추력 대 무게' })}</div>`
    : `<div class="craft-cell"><span>가속</span><b>${f(x.accel, 3)}<small>u/s²</small></b>${meter(x.accel, maxAccel, { tone: 'neutral', label: '가속' })}</div>`
}
<div class="craft-cell"><span>점화</span>${pips(x.ignitions)}</div></li>`;
    })
    .join('');
  const table = `<table class="ui-table briefing-table"><thead><tr><th>단</th><th class="num">점화 시 질량</th><th class="num">최대 추력</th><th class="num">최대 출력 연소</th><th class="num">진공 Δv</th><th class="num">점화 횟수</th>${g ? '<th class="num">추력 대 무게</th>' : ''}</tr></thead><tbody>${rows
    .map(
      (r, i) =>
        `<tr><th scope="row"><i class="swatch stage-${i + 1}"></i>${escape(r.name)}</th><td class="num">${f(r.mass)}</td><td class="num">${f(r.thrust, 3)}</td><td class="num">${f(r.burn, 1)} 초</td><td class="num">${f(r.deltaV, 3)} u/s</td><td class="num">${r.ignitions}회</td>${g ? `<td class="num">${f(r.accel / g, 2)}배</td>` : ''}</tr>`,
    )
    .join('')}</tbody></table>`;
  return `<figure class="craft-figure">${rocketSide(sizes, { width: 520, height: 46, payload: !!r.payloads?.length })}<figcaption><span>전체 Δv</span><b>${f(total, 3)}<small>u/s</small></b></figcaption>${budget}</figure><ul class="craft-stages">${stageRows}</ul><details class="briefing-numbers"><summary>숫자로 보기</summary>${table}</details>`;
}

function controlsHtml(stage: Stage) {
  const kinds: CommandKind[] = stage.rocket
    ? ['burn', 'separate', ...(stage.rocket.payloads?.length ? (['deploy'] as const) : [])]
    : stage.rules.maneuverBudget > 0
      ? ['push']
      : [];
  const limit = (k: CommandKind) => {
    const n =
      k === 'burn'
        ? (stage.rules.commandLimits?.burn ?? stage.rules.commandLimits?.ignite)
        : stage.rules.commandLimits?.[k];
    if (k === 'separate') return `${n ?? stage.rocket?.parts.length}회`;
    if (k === 'deploy') return `${stage.rocket?.payloads?.length ?? 0}회`;
    return n === undefined ? '제한 없음' : `${n}회`;
  };
  const icon: Partial<Record<CommandKind, string>> = {
    burn: 'engine',
    separate: 'separate',
    deploy: 'sensor',
    push: 'speed',
  };
  const items = [
    stage.rules.launchLimit > 0
      ? `<li>${controlIcon('rocket')}<b>발사</b><span>${stage.rocket ? '처음 출력' : '방향과 세기'}</span></li>`
      : '',
    ...kinds.map(
      (k) =>
        `<li>${controlIcon(icon[k] ?? 'sliders')}<b>${commandNames[k]}</b><span>${limit(k)}</span></li>`,
    ),
  ];
  return `<ul class="briefing-controls">${items.join('')}</ul>`;
}

export function briefingHtml(stage: Stage, eyebrow: string) {
  return `<header class="briefing-head"><span class="ui-eyebrow">${escape(eyebrow)}</span><h2 class="ui-h2">${escape(stage.title)}</h2>${stage.description ? `<p class="ui-body">${escape(stage.description)}</p>` : ''}<button id="goal-close" class="ui-btn ghost sm briefing-close" aria-label="브리핑 닫기">${controlIcon('close')}</button></header>
<section class="briefing-section"><h3 class="ui-h3">성공 조건</h3>${missionGoalsHtml(stage)}</section>
<section class="briefing-section"><h3 class="ui-h3">메달</h3><ul class="briefing-medals"><li>${medalBadge('success', true, 36)}<b>성공</b><span>성공 조건을 모두 충족</span></li><li>${medalBadge('budget', true, 36)}<b>예산 안</b><span>${stage.rocket ? '연료' : '추진'}를 90% 이하로 사용</span></li><li>${medalBadge('clean', true, 36)}<b>무손상</b><span>예산 안 + 기체 하중이 한계 미만</span></li></ul></section>
<section class="briefing-section"><h3 class="ui-h3">기체</h3>${craftHtml(stage)}</section>
<section class="briefing-section"><h3 class="ui-h3">천체</h3>${bodiesHtml(stage)}</section>
<section class="briefing-section"><h3 class="ui-h3">조작</h3>${controlsHtml(stage)}</section>
<footer class="briefing-foot"><button id="briefing-ready" class="ui-btn primary lg">계획 세우기</button></footer>`;
}

const KEY = 'apollo-briefed-v1';
/** First visit to a mission opens the briefing; players can turn auto-open off. */
export function shouldAutoBrief(stageId: string) {
  if (readSaved<boolean>('apollo-briefing-auto', true) === false) return false;
  return !readSaved<string[]>(KEY, []).includes(stageId);
}
export function markBriefed(stageId: string) {
  const seen = readSaved<string[]>(KEY, []);
  if (!seen.includes(stageId)) writeSaved(KEY, [...seen, stageId]);
}
