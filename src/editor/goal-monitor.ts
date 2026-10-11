import { escape } from '../app/core.ts';
import { expressionValue, metrics, type Condition } from '../world/conditions.ts';
import type { GoalProgress, Run, Stage } from '../world/types.ts';
const format = (value: number) => (Number.isFinite(value) ? value.toFixed(4) : '아직 관측 없음');
const operators = { lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=' };
function rows(
  node: Condition,
  p: GoalProgress,
  run: Run,
  stage: Stage,
  path = 'root',
  depth = 0,
): string {
  const indent = `style="padding-left:${depth * 10}px"`,
    context = { stage, run, before: run.position, previousTime: run.time, dt: 0 },
    memory = p.conditionMemory?.[path];
  if (node.kind === 'compare') {
    const a = expressionValue(node.left, context, p, `${path}.left`),
      b = expressionValue(node.right, context, p, `${path}.right`),
      label =
        node.left.kind === 'metric'
          ? metrics[node.left.metric]?.label
          : node.left.kind === 'recorded'
            ? `기록 ‘${node.left.key}’`
            : node.left.kind === 'window'
              ? `구간 ${node.left.operation}`
              : '계산값';
    return `<div ${indent}>${escape(label)}: <b>${format(a)}</b> ${operators[node.operator]} ${format(b)}</div>`;
  }
  if (node.kind === 'capture') {
    const record = p.checkpoints?.[node.key];
    return `<div ${indent}>기록 ${escape(node.key)}: ${record ? `${format(record.value)} (${record.time.toFixed(2)}s)` : '대기'}</div>`;
  }
  if (node.kind === 'hold')
    return `<div ${indent}>연속 유지 ${(memory?.hold ?? 0).toFixed(2)} / ${node.duration}s</div>${rows(node.child, p, run, stage, `${path}.child`, depth + 1)}`;
  if ('children' in node)
    return `<div ${indent}>${node.kind === 'sequence' ? `순서 ${memory?.index ?? 0}/${node.children.length}` : node.kind === 'all' ? 'AND' : 'OR'}</div>${node.children.map((c, i) => rows(c, p, run, stage, `${path}.${i}`, depth + 1)).join('')}`;
  if ('child' in node) return rows(node.child, p, run, stage, `${path}.child`, depth + 1);
  return `<div ${indent}>사건: ${escape(node.event)} · ${escape(node.targetId)}</div>`;
}
export function createGoalMonitor(root: HTMLElement): (run: Run, stage: Stage) => void {
  return (run, stage) => {
    let panel = root.querySelector<HTMLDetailsElement>('#goal-monitor');
    if (!panel) {
      panel = document.createElement('details');
      panel.id = 'goal-monitor';
      panel.className = 'goal-monitor panel';
      panel.innerHTML = '<summary>개발 · 판정 관찰</summary><div class="monitor-body"></div>';
      root.append(panel);
    }
    if (!panel.open) return;
    // Diagnostics read copies; observing statistics cannot advance authoritative goal state.
    panel.querySelector('.monitor-body')!.innerHTML = stage.goals
      .map(
        (g) =>
          `<article><b>${run.goals[g.id].complete ? '✓' : '◇'} ${escape(g.title)}</b>${rows(g.condition, structuredClone(run.goals[g.id]), run, stage)}</article>`,
      )
      .join('');
  };
}
