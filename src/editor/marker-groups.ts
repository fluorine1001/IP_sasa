import { escape } from '../app/core';
import { newGoal } from '../stages/factory';
import type { Stage, Goal } from '../world/types';
export function markerGroups(
  root: HTMLElement,
  getStage: () => Stage,
  apply: (goal: Goal) => void,
  signal: AbortSignal,
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'marker-groups workshop-dialog panel';
  root.append(dialog);
  let order: string[] = [],
    editing: Goal | undefined;
  let selected = new Set<string>();
  function list() {
    const stage = getStage();
    dialog.querySelector('#marker-group-list')!.innerHTML = order
      .map(
        (id, i) =>
          `<label><input type="checkbox" data-group-source="${id}" ${selected.has(id) ? 'checked' : ''}>${escape(stage.goals.find((g) => g.id === id)!.title)}<button data-group-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button data-group-down="${i}" ${i === order.length - 1 ? 'disabled' : ''}>↓</button></label>`,
      )
      .join('');
  }
  function open(goal?: Goal) {
    editing = goal;
    order = getStage()
      .goals.filter((g) => g.id !== goal?.id)
      .map((g) => g.id);
    const children = goal && 'children' in goal.condition ? goal.condition.children : [];
    selected = new Set(
      children.length ? children.flatMap((c) => (c.kind === 'reference' ? [c.goalId] : [])) : order,
    );
    order.sort(
      (a, b) =>
        children.findIndex((c) => c.kind === 'reference' && c.goalId === a) -
        children.findIndex((c) => c.kind === 'reference' && c.goalId === b),
    );
    dialog.innerHTML = `<header><h2>판정 오브젝트 연결</h2><button data-group-close aria-label="연결 창 닫기">×</button></header><label>연결 방식<select id="marker-group-mode"><option value="all">선택한 판정들이 동시에 충족</option><option value="any">선택한 판정 중 하나 충족</option><option value="sequence">목록 순서대로 판정</option></select></label><div id="marker-group-list"></div><p>동시 판정은 각 표식의 실제 조건을 같은 비행에서 함께 검사합니다. 순서 판정은 다음 표식의 관측을 앞 표식 이후에 시작합니다.</p><p data-group-error role="status"></p><button data-group-apply class="primary">연결 판정 만들기</button>`;
    list();
    if (goal && 'children' in goal.condition)
      dialog.querySelector<HTMLSelectElement>('#marker-group-mode')!.value = goal.condition.kind;
    dialog.showModal();
  }
  dialog.addEventListener(
    'change',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.groupSource) {
        if (input.checked) selected.add(input.dataset.groupSource);
        else selected.delete(input.dataset.groupSource);
      }
    },
    { signal },
  );
  dialog.addEventListener(
    'click',
    (event) => {
      const button = (event.target as HTMLElement).closest('button');
      if (!button) return;
      if (button.hasAttribute('data-group-close')) dialog.close();
      if (button.dataset.groupUp !== undefined || button.dataset.groupDown !== undefined) {
        const index = Number(button.dataset.groupUp ?? button.dataset.groupDown),
          next = index + (button.dataset.groupUp !== undefined ? -1 : 1);
        if (next >= 0 && next < order.length)
          [order[index], order[next]] = [order[next], order[index]];
        list();
      }
      if (button.hasAttribute('data-group-apply')) {
        const checked = new Set(
          [...dialog.querySelectorAll<HTMLInputElement>('[data-group-source]:checked')].map(
            (input) => input.dataset.groupSource!,
          ),
        );
        const ids = order.filter((id) => checked.has(id));
        if (!ids.length || ids.length > 32) {
          dialog.querySelector('[data-group-error]')!.textContent =
            '표식을 1~32개 선택하세요. 더 큰 구성은 연결 묶음을 다시 연결할 수 있습니다.';
          return;
        }
        const kind = dialog.querySelector<HTMLSelectElement>('#marker-group-mode')!.value as
          'all' | 'any' | 'sequence';
        apply({
          ...(editing ?? newGoal()),
          title: {
            all: '연결한 판정의 동시 충족',
            any: '연결한 판정 하나 이상 충족',
            sequence: '연결한 순서의 달성',
          }[kind],
          endTime: getStage().rules.maxTime,
          endTimeUnlimited: getStage().rules.maxTimeUnlimited,
          condition: { kind, children: ids.map((goalId) => ({ kind: 'reference', goalId })) },
        });
        dialog.close();
      }
    },
    { signal },
  );
  signal.addEventListener('abort', () => dialog.remove(), { once: true });
  return { open };
}
