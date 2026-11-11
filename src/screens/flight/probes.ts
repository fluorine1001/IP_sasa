/*
 * The player's own measurements (관측 핀): set up in the flight log, recorded with every
 * flight, compared across attempts. They only measure; nothing here judges a value.
 */
import { escape } from '../../app/core';
import { controlNames } from '../../world/plan-diff';
import { PROBE_LIMIT, probeKey, type Trial } from '../../world/evidence';
import type { Probe, RoutePlan, Stage } from '../../world/types';

const METRIC: Record<Probe['metric'], [string, string]> = {
  altitude: ['높이', 'u'],
  speed: ['상대속력', 'u/s'],
  radialSpeed: ['멀어지는 속도', 'u/s'],
};
const SUMMARY: Record<Probe['summary'], string> = { min: '가장 작을 때', max: '가장 클 때' };

function targets(stage: Stage) {
  return [
    ...stage.bodies.filter((b) => b.kind !== 'barycenter').map((b) => ({ id: b.id, name: b.name })),
    ...stage.objects.filter((o) => 'name' in o && o.name).map((o) => ({ id: o.id, name: o.name })),
  ];
}
const nameIn = (stage: Stage, id: string) => targets(stage).find((t) => t.id === id)?.name ?? '';

/** "출력 1 뒤 · 달 높이 · 가장 작을 때" */
export function probeLabel(stage: Stage, plan: RoutePlan, p: Probe) {
  const after = p.after ? controlNames(plan)[p.after] : undefined;
  return `${after ? after + ' 뒤 · ' : ''}${nameIn(stage, p.targetId)} ${METRIC[p.metric][0]} · ${SUMMARY[p.summary]}`;
}
export function probeValue(t: Trial, p: Probe) {
  const r = t.evidence.readings[probeKey(p.id)];
  return r ? `${r.value.toFixed(3)} ${METRIC[p.metric][1]} · ${r.time.toFixed(2)}초` : '—';
}

const select = (field: string, id: string, options: [string, string][], current: string) =>
  `<select data-probe-field="${field}" data-probe="${escape(id)}" aria-label="${field}">` +
  options
    .map(
      ([v, t]) =>
        `<option value="${escape(v)}"${v === current ? ' selected' : ''}>${escape(t)}</option>`,
    )
    .join('') +
  '</select>';

/** The editor: one row per probe, every part a plain choice. */
export function probeEditorHtml(stage: Stage, plan: RoutePlan, editable: boolean) {
  const probes = plan.probes ?? [];
  const names = controlNames(plan);
  const after: [string, string][] = [
    ['', '처음부터'],
    ...Object.entries(names).map(([id, n]) => [id, n + ' 뒤'] as [string, string]),
  ];
  const rows = probes
    .map(
      (p) =>
        `<li class="probe-row">` +
        select('after', p.id, after, p.after ?? '') +
        select(
          'target',
          p.id,
          targets(stage).map((t) => [t.id, t.name]),
          p.targetId,
        ) +
        select(
          'metric',
          p.id,
          Object.entries(METRIC).map(([k, [w]]) => [k, w]),
          p.metric,
        ) +
        select('summary', p.id, Object.entries(SUMMARY) as [string, string][], p.summary) +
        `<button data-probe-remove="${escape(p.id)}" aria-label="관측 삭제" title="관측 삭제">×</button></li>`,
    )
    .join('');
  return (
    `<section class="probe-editor"><h3>내 관측 <small>${probes.length} / ${PROBE_LIMIT}</small></h3>` +
    `<fieldset ${editable ? '' : 'disabled'}><ul>${rows}</ul>` +
    (probes.length < PROBE_LIMIT ? '<button data-probe-add>관측 추가</button>' : '') +
    '</fieldset></section>'
  );
}

/** Apply one editor event to the plan; returns whether anything changed. */
export function editProbes(stage: Stage, plan: RoutePlan, target: HTMLElement): boolean {
  if (target.closest('[data-probe-add]')) {
    const probes = (plan.probes ??= []);
    if (probes.length >= PROBE_LIMIT) return false;
    const first = targets(stage)[0];
    if (!first) return false;
    probes.push({
      id: crypto.randomUUID(),
      metric: 'altitude',
      targetId: first.id,
      summary: 'min',
    });
    return true;
  }
  const remove = target.closest<HTMLElement>('[data-probe-remove]');
  if (remove) {
    plan.probes = (plan.probes ?? []).filter((p) => p.id !== remove.dataset.probeRemove);
    return true;
  }
  const field = target.closest<HTMLSelectElement>('select[data-probe-field]');
  if (!field) return false;
  const probe = plan.probes?.find((p) => p.id === field.dataset.probe);
  if (!probe) return false;
  const v = field.value;
  if (field.dataset.probeField === 'after') probe.after = v || undefined;
  if (field.dataset.probeField === 'target') probe.targetId = v;
  if (field.dataset.probeField === 'metric') probe.metric = v as Probe['metric'];
  if (field.dataset.probeField === 'summary') probe.summary = v as Probe['summary'];
  return true;
}

/** Rows of the comparison table for the probes either flight carried. */
export function probeRowsHtml(stage: Stage, a: Trial, b: Trial) {
  const all = new Map<string, { probe: Probe; plan: RoutePlan }>();
  for (const t of [a, b])
    for (const p of t.scheduledPlan.probes ?? [])
      all.set(p.id, { probe: p, plan: t.scheduledPlan });
  return [...all.values()]
    .map(
      ({ probe, plan }) =>
        `<tr><th>${escape(probeLabel(stage, plan, probe))}</th><td>${probeValue(a, probe)}</td><td>${probeValue(b, probe)}</td></tr>`,
    )
    .join('');
}
