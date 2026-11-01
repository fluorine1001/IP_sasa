import { escape } from '../../app/core';
import { launchFraction, programWarnings } from '../../world/program';
import { length } from '../../physics/vector';
import type { RoutePlan, Stage } from '../../world/types';

type Row = { tone: 'ok' | 'warn' | 'bad'; label: string; value?: string };

const KIND_NAME: Record<string, string> = {
  ignite: '점화',
  stop: '엔진 끄기',
  turn: '회전',
  separate: '단 분리',
  push: '수정 추진',
  deploy: '위성 분리',
};

/** Plan bookkeeping only. It never integrates the flight, so it predicts nothing. */
export function preflightChecklist(stage: Stage, plan: RoutePlan) {
  const warnings = programWarnings(stage, plan);
  const errors = warnings.filter((w) => !w.includes('마지막 추진단까지 버립니다'));
  const rows: Row[] = [];

  if (stage.rocket) {
    const parts = stage.rocket.parts;
    const craft = [...(plan.engineCommands ?? [])]
      .filter((c) => c.actorId === 'craft' && !c.releasePayload)
      .sort((a, b) => a.time - b.time);
    const ignitions = parts.map((_, i) => (i === 0 && launchFraction(stage, plan) > 0 ? 1 : 0));
    let index = 0,
      burning = ignitions[0] > 0;
    for (const c of craft) {
      if (c.separate) {
        index++;
        burning = false;
      } else if (c.throttle !== undefined) {
        if (c.throttle > 0 && !burning && parts[index]) ignitions[index]++;
        burning = c.throttle > 0;
      }
    }
    parts.forEach((p, i) => {
      if (i > index) return;
      const over = ignitions[i] > p.ignitionLimit;
      rows.push({
        tone: over ? 'bad' : 'ok',
        label: `${i + 1}단 점화`,
        value: `${ignitions[i]} / ${p.ignitionLimit}회 · 연료 ${((p.fuelMass * p.exhaustSpeed) / p.thrust).toFixed(1)}초`,
      });
    });
    // The next stage never lights itself; a separation with no later ignition is worth a glance.
    craft.forEach((c, i) => {
      if (!c.separate) return;
      const relit = craft
        .slice(i + 1)
        .some((later) => !later.separate && (later.throttle ?? 0) > 0);
      if (!relit && i < parts.length - 1)
        rows.push({ tone: 'warn', label: `${c.time.toFixed(1)}초 분리 뒤 점화 없음` });
    });
  } else if (stage.rules.maneuverBudget > 0) {
    const used = plan.impulses.reduce((sum, impulse) => sum + length(impulse.vector), 0);
    rows.push({
      tone: used > stage.rules.maneuverBudget + 1e-8 ? 'bad' : 'ok',
      label: '추진 예산',
      value: `${used.toFixed(2)} / ${stage.rules.maneuverBudget.toFixed(2)} u/s`,
    });
  }

  const counts: Record<string, number> = {};
  for (const c of plan.engineCommands ?? []) {
    const kind = c.releasePayload
      ? 'deploy'
      : c.separate
        ? 'separate'
        : c.throttle !== undefined
          ? c.throttle > 0
            ? 'ignite'
            : 'stop'
          : 'turn';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  counts.push = plan.impulses.length;
  for (const [kind, limit] of Object.entries(stage.rules.commandLimits ?? {})) {
    if (limit === undefined || !KIND_NAME[kind]) continue;
    const left = limit - (counts[kind] ?? 0);
    if (left < limit || left < 0)
      rows.push({
        tone: left < 0 ? 'bad' : 'ok',
        label: `${KIND_NAME[kind]} 예약`,
        value: `남은 ${Math.max(0, left)}회`,
      });
  }

  for (const e of errors)
    if (!rows.some((r) => r.tone === 'bad' && e.includes('재점화')))
      rows.push({ tone: 'bad', label: e });

  const ready = errors.length === 0;
  return {
    ready,
    html: `<header><b>발사 전 점검</b><span class="${ready ? 'ok' : 'bad'}">${ready ? '발사 가능' : '발사 불가'}</span></header><ul>${rows
      .map(
        (r) =>
          `<li class="${r.tone}"><i aria-hidden="true">${r.tone === 'ok' ? '✓' : r.tone === 'warn' ? '!' : '✕'}</i><span>${escape(r.label)}</span>${r.value ? `<b>${escape(r.value)}</b>` : ''}</li>`,
      )
      .join('')}</ul>`,
  };
}
