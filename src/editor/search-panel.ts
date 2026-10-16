import { representativeReplay } from './representative-replay';
import { issues } from '../stages/validation';
import { physicalPlanKey } from './solution-groups';
import { escape } from '../app/core';
import {
  searchTemplates,
  type SearchTemplate,
  type SearchReport,
  type SolutionFamily,
} from './solution-search';
import type { Stage, RoutePlan, Run } from '../world/types';
import SearchWorker from './search.worker?worker&inline';
import BlockerWorker from './blockers.worker?worker&inline';
import { SearchClient } from './search-client';
import { launchBalanceMarkup } from './launch-balance';
export function solutionSearchPanel(
  root: HTMLElement,
  signal: AbortSignal,
  getStage: () => Stage,
  changed: (stage?: Stage, preserveSearch?: boolean) => void,
) {
  const panel = document.createElement('section');
  panel.id = 'solution-search';
  panel.className = 'editor-search panel';
  root.querySelector('.editor')!.append(panel);
  let templates: SearchTemplate[] = [],
    selected = '',
    worker: SearchClient | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    revision = 0,
    result: SearchReport | undefined,
    history: Run['trail'] = [];
  const playback = representativeReplay(root, getStage, signal);
  let enabled = true,
    continuous = true,
    paused = false,
    budgetValue = 8192,
    maxCommands: number | undefined;
  let chosenFamily = -1;
  let rendered = '';
  const auxiliary = new Set<Worker>();
  function template() {
    return templates.find((item) => item.id === selected) ?? templates[0];
  }
  function form() {
    const audit = root.querySelector<HTMLElement>('#audit');
    panel.innerHTML = `<div class="search-config"><header><b>풀이 탐색</b><button id="search-run">탐색</button><button id="search-stop">중지</button></header><label><input id="search-auto" type="checkbox" ${enabled ? 'checked' : ''}> 변경 후 자동</label><details class="search-options"><summary>탐색 범위·예산</summary><label><input id="search-continuous" type="checkbox" ${continuous ? 'checked' : ''}> 중지할 때까지 계속 탐색</label><select id="search-layout" aria-label="조사할 예약 구성"><option value="all" ${selected === 'all' ? 'selected' : ''}>모든 허용 조작</option>${templates.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escape(item.label)} · 범위 조사</option>`).join('')}</select><label>작업 묶음 크기<input id="search-budget" type="number" min="16" max="8192" value="${budgetValue}"></label><label>예약 개수 상한<input id="search-depth" type="number" min="0" max="256" value="${maxCommands ?? ''}" placeholder="스테이지 한도 사용"></label><details><summary>변수 범위·고정</summary><div id="search-parameters"></div></details></details><button id="search-continue" hidden>더 조사</button></div><div class="search-results"><div class="search-heading"><b id="search-status">준비 중</b><progress id="search-progress" max="512" value="0"></progress></div><details class="coverage-details"><summary>탐색 진행 정보</summary><small id="search-coverage"></small><p>비슷한 실제 비행을 하나의 풀이로 묶습니다. 시각 차이만으로 나누지 않습니다.</p></details><div id="search-families"></div><nav id="search-pages" hidden></nav></div>`;
    playback.mount(panel.querySelector('.search-results')!);
    if (audit) {
      audit.className = 'integrated-audit';
      const review = document.createElement('details');
      review.className = 'design-review';
      review.innerHTML = '<summary>설계 검사·공개 준비</summary>';
      review.append(audit);
      panel.querySelector('.search-results')!.append(review);
    }
    parameters();
    panel
      .querySelector('.search-config')!
      .insertAdjacentHTML('beforeend', launchBalanceMarkup(getStage()));
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
    status.textContent = result.proof
      ? result.proof.kind === 'control-envelope'
        ? '도달 한계 확인 · 허용된 추진 전체의 도달 범위와 목표가 겹치지 않습니다.'
        : '조건 충돌 확인 · ' + result.proof.reasons.join(' ')
      : `${paused ? '탐색 중지' : result.done ? '이번 검사 완료' : '조사 중'} · ${continuous && selected === 'all' && !paused && !result.done ? `${result.evaluated}회` : `${result.evaluated}/${result.budget}`} · 성공 ${result.successes} · 풀이 그룹 ${result.families.length} · ${(result.evaluated / Math.max(0.001, result.elapsed / 1000)).toFixed(0)}회/초`;
    const progress = panel.querySelector<HTMLProgressElement>('#search-progress')!;
    progress.max = result.budget;
    progress.value = result.evaluated;
    if (continuous && selected === 'all' && !paused && !result.done)
      progress.removeAttribute('value');
    const scope = result.scope;
    panel.querySelector('#search-coverage')!.textContent = result.proof
      ? '실제 비행 표본이 아닌 전체 허용 범위의 필요조건 검사'
      : scope
        ? `예약 길이 ${scope.maxCommands}개까지 · 시간 창 ${scope.horizon}초 · 정밀도 ${result.coverage?.divisions ?? '-'} · 공통 구간 ${result.reuse?.prefixes ?? 0}회 재사용 · 기존 위치부터 진행`
        : '선택한 구성·변수 범위만 조사 중';
    const more = panel.querySelector<HTMLButtonElement>('#search-continue')!;
    more.hidden = !(
      selected === 'all' &&
      worker &&
      worker.active &&
      (paused || (result.done && result.continuable)) &&
      !result.proof
    );
    more.textContent = paused ? '재개' : '더 조사';
    const signature =
      JSON.stringify(result.families.map((f) => [f.id, f.count])) + result.done + paused;
    if (signature === rendered) return;
    rendered = signature;
    const opened = new Set(
      [...panel.querySelectorAll<HTMLDetailsElement>('[data-family-details][open]')].map(
        (d) => d.dataset.familyDetails,
      ),
    );
    panel.querySelector('#search-families')!.innerHTML =
      result.families
        .map(
          (family, index) => `
      <article class="solution-family ${family.id === chosenFamily ? 'selected' : ''}" data-family-card="${family.id}">
      <header><button data-family-path="${family.id}" aria-pressed="${family.id === chosenFamily}"><b>풀이 ${index + 1}</b><span>${family.count}개 확인</span></button><button data-family-test="${family.id}" title="선택한 실제 기록 재생">▶ 재생</button></header>
      <small>${escape(family.template)}</small>
      <details data-family-details="${family.id}" ${opened.has(String(family.id)) ? 'open' : ''}><summary>예약 범위·제작 작업</summary>
      <div class="family-ranges">${family.ranges.map((r) => `<div><span>${escape(r.label)}</span><b>${r.min.toFixed(2)}–${r.max.toFixed(2)}</b></div>`).join('')}</div>
      <small>확인한 연결 ${family.connections ?? 0}개 · 표시 범위 전체의 성공 보장은 아님</small>
      <div class="family-actions"><button data-family-save="${family.id}">성공 기록 보관</button><button data-family-block="${family.id}" ${result!.done || paused ? '' : 'disabled'}>차단안 검사</button></div><div data-family-proposals="${family.id}"></div>
      </details></article>`,
        )
        .join('') ||
      (result.proof
        ? ''
        : '<p class="search-empty">아직 성공 기록이 없습니다. 더 조사하거나 실제 비행으로 조건·기체 성능을 확인하세요.</p>');
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
    chosenFamily = -1;
    rendered = '';
  }
  function run() {
    invalidate();
    const errors = issues(getStage());
    if (errors.length) {
      panel.querySelector('#search-status')!.textContent = errors[0];
      return;
    }
    const current = revision,
      choice = template();
    if (!choice) return;
    const budget = Number(panel.querySelector<HTMLInputElement>('#search-budget')!.value);
    panel.querySelector('#search-run')!.textContent = '탐색';
    worker = new SearchClient(() => new SearchWorker({ name: 'solution-search' }), {
      result: (report) => {
        if (current !== revision) return;
        result = report;
        playback.setFamilies(result.families);
        show();
      },
      recovering: () => {
        if (current === revision)
          panel.querySelector('#search-status')!.textContent = '탐색 연결 복구 중…';
      },
      fault: (fault) => {
        if (current !== revision) return;
        paused = true;
        show();
        panel.querySelector('#search-status')!.textContent =
          `탐색 중단 · ${result?.families.length ? '찾은 결과는 보존했습니다. ' : ''}${fault.message}`;
        panel.querySelector('#search-run')!.textContent = '다시 탐색';
      },
    });
    worker.start({
      revision: current,
      stage: structuredClone(getStage()),
      templates: structuredClone(selected === 'all' ? templates : [choice]),
      budget,
      global: selected === 'all',
      maxCommands,
      continuous,
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
    const ready = !issues(getStage()).length;
    panel.querySelector<HTMLButtonElement>('#search-run')!.disabled = !ready;
    if (!ready)
      panel.querySelector('#search-status')!.textContent =
        '기체와 판정을 배치하면 탐색할 수 있습니다.';
    if (enabled && ready) timer = setTimeout(run, 750);
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
      if (input.id === 'search-continuous') {
        continuous = input.checked;
        if (enabled) run();
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
        worker.postMessage({
          revision,
          continue: true,
          continuous,
          extraBudget: Math.max(16, budgetValue),
        });
        paused = false;
        result.done = false;
        show();
        return;
      }
      if (button.id === 'search-stop') {
        worker?.postMessage({ revision, pause: true });
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
      if (button.dataset.familyPath !== undefined || button.dataset.familyTest !== undefined) {
        chosenFamily = family.id;
        panel.querySelectorAll<HTMLElement>('[data-family-card]').forEach((card) => {
          const selected = Number(card.dataset.familyCard) === chosenFamily;
          card.classList.toggle('selected', selected);
          card.querySelector('[data-family-path]')?.setAttribute('aria-pressed', String(selected));
        });
      }
      if (button.dataset.familySave !== undefined) {
        const stage = structuredClone(getStage());
        const duplicate = stage.referencePlans.some(
          (p) => physicalPlanKey(stage, p) === physicalPlanKey(stage, family.representative),
        );
        if (!duplicate && stage.referencePlans.length >= 30) {
          button.textContent = '보관 한도 30개';
          return;
        }
        if (!duplicate) stage.referencePlans.push(structuredClone(family.representative));
        if (
          family.horizon &&
          family.horizon <= 600 &&
          family.horizon > (stage.audit.timeLimit ?? stage.rules.maxTime)
        )
          stage.audit.timeLimit = family.horizon;
        changed(stage, true);
        button.textContent = '초안에 보관됨';
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
        let checker: Worker;
        try {
          checker = new BlockerWorker({ name: 'solution-blockers' });
        } catch (error) {
          target.textContent = `차단안 검사를 시작하지 못했습니다. ${error instanceof Error ? error.message : ''}`;
          return;
        }
        auxiliary.add(checker);
        const failed = (text: string) => {
          checker.terminate();
          auxiliary.delete(checker);
          if (current === revision) target.textContent = text;
        };
        checker.onerror = (event) => {
          event.preventDefault();
          failed(`차단안 검사 중단 · ${event.message || '다시 검사해 주세요.'}`);
        };
        checker.onmessageerror = () =>
          failed('차단안 결과를 전달하지 못했습니다. 다시 검사해 주세요.');
        checker.onmessage = (message) => {
          if (current !== revision) return;
          checker.terminate();
          auxiliary.delete(checker);
          if (!Array.isArray(message.data.proposals)) {
            failed(message.data.error || '차단안 결과가 유효하지 않습니다.');
            return;
          }
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
        try {
          checker.postMessage({
            stage: structuredClone(getStage()),
            family: structuredClone(family),
            others: structuredClone(
              result!.families
                .filter((item) => item.id !== family.id)
                .flatMap((item) => [item.representative, ...item.samples]),
            ),
          });
        } catch (error) {
          failed(
            `차단안 전달 중단 · ${error instanceof Error ? error.message : '다시 검사해 주세요.'}`,
          );
        }
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
    leaveReplay() {
      playback.leave();
    },
    frame(dt: number) {
      return playback.frame(dt);
    },
  };
}
