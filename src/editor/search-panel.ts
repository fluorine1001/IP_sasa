import { representativeReplay } from './representative-replay';
import { escape } from '../app/core';
import {
  searchTemplates,
  type SearchTemplate,
  type SearchReport,
  type SolutionFamily,
} from './solution-search';
import type { Stage, RoutePlan, Run } from '../world/types';
export function solutionSearchPanel(
  root: HTMLElement,
  signal: AbortSignal,
  getStage: () => Stage,
  changed: (stage?: Stage) => void,
) {
  const panel = document.createElement('section');
  panel.id = 'solution-search';
  panel.className = 'editor-search panel';
  root.querySelector('.editor')!.append(panel);
  let templates: SearchTemplate[] = [],
    selected = '',
    worker: Worker | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    revision = 0,
    result: SearchReport | undefined,
    history: Run['trail'] = [];
  const playback = representativeReplay(root, getStage, signal);
  let enabled = true,
    paused = false,
    budgetValue = 512,
    maxCommands: number | undefined,
    familyPage = 0;
  const auxiliary = new Set<Worker>();
  function template() {
    return templates.find((item) => item.id === selected) ?? templates[0];
  }
  function form() {
    panel.innerHTML = `<div class="search-config"><header><b>유효해 탐색</b><button id="search-stop">중지</button></header><label><input id="search-auto" type="checkbox" ${enabled ? 'checked' : ''}> 수정 후 자동 탐색</label><select id="search-layout" aria-label="조사할 예약 구성"><option value="all" ${selected === 'all' ? 'selected' : ''}>전체 조작 구성 탐색</option>${templates.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escape(item.label)} · 범위 조사</option>`).join('')}</select><label>검사 예산<input id="search-budget" type="number" min="16" max="8192" value="${budgetValue}"></label><label>조사할 예약 최대 개수<input id="search-depth" type="number" min="0" max="256" value="${maxCommands ?? ''}" placeholder="빈칸: 스테이지 한도 · 무제한은 6"></label><details><summary>변수 범위 · 고정 / 탐색</summary><div id="search-parameters"></div></details><button id="search-run">탐색 시작</button></div><div class="search-results"><div id="search-status">준비 중</div><progress id="search-progress" max="512" value="0"></progress><small id="search-coverage"></small><small>그룹은 같은 조작 순서·대상에서 중간 성공 표본으로 연결한 집합입니다. 경계 안의 모든 값이 성공한다는 증명은 아니며 미검사 구간이 남습니다.</small><div id="search-families"></div><nav id="search-pages"></nav></div>`;
    parameters();
  }
  function parameters() {
    panel.querySelector('#search-parameters')!.innerHTML =
      selected === 'all'
        ? '<small>허용된 조작 횟수·순서·분리체 대상을 자동 생성하고 시간·출력·방향의 전체 범위를 조사합니다. 저장된 기록은 초기 표본일 뿐 탐색을 제한하지 않습니다. 특정 구성 선택은 별도의 범위 조사입니다.</small>'
        : (template()?.parameters ?? [])
            .map(
              (p, i) =>
                `<label class="search-parameter"><input type="checkbox" data-search-enabled="${i}" ${p.enabled ? 'checked' : ''}><span>${escape(p.label)}</span><input type="number" step="any" data-search-min="${i}" value="${p.min}" aria-label="${escape(p.label)} 최솟값"><input type="number" step="any" data-search-max="${i}" value="${p.max}" aria-label="${escape(p.label)} 최댓값"></label>`,
            )
            .join('');
  }
  function show() {
    const status = panel.querySelector('#search-status')!;
    if (!result) {
      status.textContent = paused
        ? '탐색 중지 · 조건 수정 후 다시 시작 가능'
        : '물리 엔진에서 검사 중…';
      return;
    }
    status.textContent = `${paused ? '탐색 중지' : result.done ? '이번 검사 완료' : '조사 중'} · ${result.evaluated}/${result.budget} · 성공 ${result.successes} · 연결 집합 ${result.families.length} · ${(result.evaluated / Math.max(0.001, result.elapsed / 1000)).toFixed(0)}회/초`;
    const progress = panel.querySelector<HTMLProgressElement>('#search-progress')!;
    progress.max = result.budget;
    progress.value = result.evaluated;
    const scope = result.scope;
    panel.querySelector('#search-coverage')!.textContent = scope
      ? `예약 구성 ${scope.programs}개 조사 / ${scope.total ?? '집계 한도 초과'}개 · 최대 ${scope.maxCommands}개 예약 · ${scope.horizon}초까지 · ${scope.bounded ? '스테이지 예약 개수 범위 전체' : '이보다 긴 예약 구성은 미검사'} · ${scope.exhausted ? '구성 열거 완료 (연속 값은 미검사 구간 있음)' : '미조사 구성 남음'}`
      : '선택한 구성·변수 범위만 조사 중';
    const pages = Math.max(1, Math.ceil(result.families.length / 24));
    familyPage = Math.min(familyPage, pages - 1);
    panel.querySelector('#search-pages')!.innerHTML =
      pages > 1
        ? `<button id="search-prev" ${familyPage === 0 ? 'disabled' : ''}>이전 집합</button><span>${familyPage + 1}/${pages}</span><button id="search-next" ${familyPage === pages - 1 ? 'disabled' : ''}>다음 집합</button>`
        : '';
    if (selected === 'all' && result.done && result.continuable && worker && !paused)
      panel
        .querySelector('#search-pages')!
        .insertAdjacentHTML('beforeend', '<button id="search-continue">이어서 더 조사</button>');
    panel.querySelector('#search-families')!.innerHTML =
      result.families
        .slice(familyPage * 24, (familyPage + 1) * 24)
        .map(
          (family, index) =>
            `<article class="solution-family"><div><b>집합 ${familyPage * 24 + index + 1}</b><span>${family.count}개 성공 표본</span></div><small>${escape(family.template)}</small><small>검사한 연결 ${family.connections ?? 0}개${(family.layouts ?? 1) > 1 ? ` · 동일 비행을 공유한 구성 ${family.layouts}개` : ''} · 연결 구간은 ¼·½·¾ 지점에서 실제 성공 확인</small><button data-family-path="${family.id}">실제 경로 보기</button><button data-family-test="${family.id}">대표 비행 재생</button><details><summary>확인한 변수 범위 · 성공 표본 간격</summary>${family.ranges.map((range) => `<div>${escape(range.label)} <b>${range.min.toFixed(2)}~${range.max.toFixed(2)}</b>${range.max > range.min ? `<meter max="${range.max - range.min}" value="${range.gap ?? range.max - range.min}" title="확인한 범위 내 가장 큰 표본 간격"></meter><small>가장 큰 성공 표본 간격 ${(range.gap ?? range.max - range.min).toFixed(3)} · 표본 사이의 성공은 보장하지 않음</small>` : '<small>단일 값만 확인</small>'}</div>`).join('')}</details><button data-family-save="${family.id}">성공 비행 보관</button><button data-family-block="${family.id}" ${result?.done ? '' : 'disabled'}>차단 수정안 검사</button><div data-family-proposals="${family.id}"></div></article>`,
        )
        .join('') ||
      '<p>현재 검사 표본에는 성공이 없습니다. 미검사 구간의 실패를 뜻하지 않습니다.</p>';
  }
  function invalidate() {
    revision++;
    worker?.terminate();
    worker = undefined;
    auxiliary.forEach((job) => job.terminate());
    auxiliary.clear();
    clearTimeout(timer);
    result = undefined;
    history = [];
    playback.reset();
    paused = false;
    familyPage = 0;
  }
  function run() {
    invalidate();
    const current = revision,
      choice = template();
    if (!choice) return;
    const budget = Number(panel.querySelector<HTMLInputElement>('#search-budget')!.value);
    worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      if (event.data.revision !== revision) return;
      if (event.data.error) {
        panel.querySelector('#search-status')!.textContent = event.data.error;
        return;
      }
      result = event.data.result;
      if (result?.done) playback.setFamilies(result.families);
      show();
    };
    worker.onerror = () => {
      panel.querySelector('#search-status')!.textContent = '탐색 작업자 오류';
    };
    worker.postMessage({
      revision: current,
      stage: structuredClone(getStage()),
      templates: structuredClone(selected === 'all' ? templates : [choice]),
      budget,
      global: selected === 'all',
      maxCommands,
    });
    show();
  }
  function refresh() {
    const old = template();
    invalidate();
    templates = searchTemplates(getStage());
    selected =
      selected === 'all' || !selected
        ? 'all'
        : (templates.find((item) => item.label === old?.label)?.id ?? 'all');
    const next = template();
    if (old && next && old.label === next.label)
      for (const parameter of next.parameters) {
        const previous = old.parameters.find((item) => item.key === parameter.key);
        if (previous) {
          parameter.min = previous.min;
          parameter.max = previous.max;
          parameter.enabled = previous.enabled;
        }
      }
    form();
    if (enabled) timer = setTimeout(run, 750);
  }
  panel.addEventListener(
    'change',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id === 'search-auto') {
        enabled = input.checked;
        if (!enabled) {
          invalidate();
          paused = true;
          show();
        } else run();
        return;
      }
      if (input.id === 'search-layout') {
        selected = input.value;
        parameters();
        run();
        return;
      }
      if (input.id === 'search-budget') {
        budgetValue = Number(input.value);
        if (enabled) run();
        return;
      }
      if (input.id === 'search-depth') {
        maxCommands = input.value === '' ? undefined : Number(input.value);
        if (enabled) run();
        return;
      }
      const p =
        template()?.parameters[
          Number(input.dataset.searchEnabled ?? input.dataset.searchMin ?? input.dataset.searchMax)
        ];
      if (p) {
        if (input.dataset.searchEnabled !== undefined) p.enabled = input.checked;
        if (input.dataset.searchMin !== undefined) p.min = Number(input.value);
        if (input.dataset.searchMax !== undefined) p.max = Number(input.value);
        if (enabled) run();
      }
    },
    { signal },
  );
  panel.addEventListener(
    'click',
    async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.id === 'search-run') run();
      if (button.id === 'search-continue' && result && worker) {
        worker.postMessage({ revision, continue: true, extraBudget: Math.max(16, budgetValue) });
        result.done = false;
        show();
        return;
      }
      if (button.id === 'search-prev') {
        familyPage--;
        show();
      }
      if (button.id === 'search-next') {
        familyPage++;
        show();
      }
      if (button.id === 'search-stop') {
        revision++;
        worker?.terminate();
        worker = undefined;
        clearTimeout(timer);
        auxiliary.forEach((job) => job.terminate());
        auxiliary.clear();
        paused = true;
        if (result) result.done = true;
        show();
      }
      const family = result?.families.find(
        (item) =>
          item.id ===
          Number(
            button.dataset.familyPath ??
              button.dataset.familyTest ??
              button.dataset.familySave ??
              button.dataset.familyBlock,
          ),
      );
      if (!family) return;
      if (button.dataset.familySave !== undefined) {
        const stage = structuredClone(getStage());
        if (
          !stage.referencePlans.some(
            (p) => JSON.stringify(p) === JSON.stringify(family.representative),
          )
        )
          stage.referencePlans.push(structuredClone(family.representative));
        changed(stage);
        return;
      }
      if (button.dataset.familyTest !== undefined) playback.select(family, true);
      if (button.dataset.familyPath !== undefined) {
        playback.select(family);
      }
      if (button.dataset.familyBlock !== undefined) {
        const current = revision,
          target = panel.querySelector(`[data-family-proposals="${family.id}"]`)!;
        target.textContent = '이 집합 차단과 다른 발견된 해에 미치는 영향 검사 중…';
        const checker = new Worker(new URL('./blockers.worker.ts', import.meta.url), {
          type: 'module',
        });
        auxiliary.add(checker);
        checker.onmessage = (message) => {
          if (current !== revision) return;
          checker.terminate();
          auxiliary.delete(checker);
          const proposals = message.data.proposals as {
            label: string;
            stage: Stage;
            blocked: number;
            remaining: number;
            otherTotal: number;
            nearby: number;
            nearbyTotal: number;
          }[];
          target.innerHTML =
            proposals
              .map(
                (proposal, i) =>
                  `<div><b>${escape(proposal.label)}</b><small>집합 표본 ${proposal.blocked}/${family.samples.length} 차단 · 다른 해 ${proposal.remaining}/${proposal.otherTotal} 유지 · 근처 ${proposal.nearby}/${proposal.nearbyTotal} 성공</small><button data-apply-proposal="${i}">이 수정 적용</button></div>`,
              )
              .join('') ||
            '<small>검사한 수정안으로 이 집합의 표본을 모두 막지 못했습니다. 결과 생성 폼에서 목표의 물리적 의미를 바꿀 수도 있습니다. 가능한 모든 수정안을 검사한 것은 아닙니다.</small>';
          target
            .querySelectorAll<HTMLButtonElement>('[data-apply-proposal]')
            .forEach(
              (apply) =>
                (apply.onclick = () =>
                  changed(proposals[Number(apply.dataset.applyProposal)].stage)),
            );
        };
        checker.postMessage({
          stage: structuredClone(getStage()),
          family: structuredClone(family),
          others: structuredClone(
            result!.families
              .filter((item) => item.id !== family.id)
              .map((item) => item.representative),
          ),
        });
      }
    },
    { signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      invalidate();
      panel.remove();
    },
    { once: true },
  );
  refresh();
  return {
    refresh,
    get history() {
      return playback.history.length ? playback.history : history;
    },
    get histories() {
      return playback.histories;
    },
    get stage() {
      return playback.stage;
    },
    frame(dt: number) {
      return playback.frame(dt);
    },
  };
}
