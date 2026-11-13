import './style.css';
import GeneratorWorker from './generation.worker?worker';
import { escape } from '../../app/core';
import { parseStage } from '../../stages/validation';
import type { Stage } from '../../world/types';
import { templateNames } from './templates';
import { difficulties, type Difficulty } from './difficulty';
import { candidatePreview } from './preview';
import { createMethodReview } from './review-panel';
import { createCollectionPanel } from './collection-panel';
import { masteryFocuses, type MasterySettings } from './mastery-settings';
import {
  validateRequest,
  type GenerationRequest,
  type GenerationReport,
  type GenerationResponse,
} from './protocol';

/** A separate authoring dialog; the existing document is touched only by explicit Open. */
export function stageGenerator(
  root: HTMLElement,
  signal: AbortSignal,
  openStage: (stage: Stage) => void,
) {
  const button = document.createElement('button');
  button.id = 'generate-maps';
  button.textContent = '맵 자동 생성';
  root.querySelector('#compose-goal')!.after(button);
  const dialog = document.createElement('dialog');
  dialog.className = 'map-generator workshop-dialog panel';
  dialog.setAttribute('aria-labelledby', 'map-generator-title');
  dialog.innerHTML = `<header><div><small>제작 도구</small><h2 id="map-generator-title">맵 자동 생성</h2></div><button type="button" data-generator-close aria-label="맵 자동 생성 닫기">×</button></header>
    <p>임무 틀에서 후보를 만들고 실제 비행으로 검사합니다. 선택해 열기 전까지 현재 초안은 유지됩니다.</p>
    <form class="generator-settings"><fieldset class="generator-difficulty"><legend>생성 난이도</legend><div class="generator-difficulty-buttons">${Object.entries(
      difficulties,
    )
      .map(
        ([id, value]) =>
          `<button type="button" data-difficulty="${id}" aria-pressed="${id === 'easy'}">${value.name}</button>`,
      )
      .join(
        '',
      )}</div><p data-difficulty-description></p><small>모든 후보는 행성 표면의 실제 로켓 발사대에서 시작합니다. 설정은 다음 생성에 적용됩니다.</small></fieldset><label>임무 종류<select name="kind"><option value="mixed">두 임무 섞기</option>${Object.entries(
      templateNames,
    )
      .map(([id, name]) => `<option value="${id}">${name}</option>`)
      .join('')}</select></label>
    <label>후보 개수<input name="count" type="number" min="1" max="12" step="1" value="6" required></label>
    <label>행성 수<select name="planetCount"><option value="auto">자동 · 1~3개 섞기</option><option value="1">1개</option><option value="2">2개</option><option value="3">3개</option></select></label>
    <label>생성 번호<input name="seed" type="number" min="1" max="4294967295" step="1" value="31415" required></label>
    <label>목표 허용 폭<select name="margin"><option value="wide">넉넉하게</option><option value="standard">보통</option></select></label>
    <label class="generator-seed-mode"><input name="freshSeed" type="checkbox" checked>생성할 때 새 번호 사용</label>
    <details class="generator-mastery"><summary>추가 설정 · 조작 숙달 묶음</summary><label class="generator-seed-mode"><input name="masteryEnabled" type="checkbox">조작 숙달 묶음 만들기</label><div data-mastery-settings hidden><div class="mastery-fields"><label>묶음 수<select name="masteryGroups"><option value="2">2개 · 출력 조절까지</option><option value="3" selected>3개 · 중간 회전까지</option><option value="4">4개 · 재점화까지</option></select></label><label>묶음당 스테이지<select name="masteryPerGroup"><option value="2">2개 · 도입과 응용</option><option value="3">3개 · 도입·반복·응용</option></select></label></div><p>앞에서 배운 조작을 계속 활용하며 새 조작 하나씩 연습합니다. 난이도 버튼 대신 조작 학습 순서에 맞는 배치를 만들며, 게임 잠금이나 플레이어 숙달 판정은 추가하지 않습니다.</p><ol data-mastery-outline></ol><small data-mastery-total></small></div></details>
    <div class="generator-actions"><button type="submit" class="primary">후보 생성</button><button type="submit" data-progression>학습 순서용 후보 생성</button><button type="button" data-generator-stop disabled>중지</button></div></form>
    <p class="generator-note">기본은 매번 새 배치입니다. ‘새 번호 사용’을 끄고 생성 번호와 설정을 같게 하면 같은 후보를 재현합니다. 만든 스테이지의 재시도 환경은 고정됩니다.</p>
    <p data-generator-status role="status" aria-live="polite">종류와 개수를 정한 뒤 후보를 생성하세요.</p>
    <div data-generator-results class="generator-results"></div>
    <details class="generator-details"><summary>검사 범위와 저장</summary><p>발사대와 목표의 상대 배치, 실제 경로의 굽음, 주변 중력, 조작 오차를 함께 검사합니다.</p><p>출력 조절·방향 수정·재점화를 포함한 여러 조작 방식을 둥근 수치로 검사합니다. 새로 넣은 조작은 생략 시 성공하지 못해야 별도 풀이로 남깁니다. 검사는 최적 풀이 증명이나 실제 사람의 체감 난이도 인증이 아닙니다.</p><p>학습 순서용 생성은 쉬움·보통·도전 후보를 함께 제안합니다. 모음은 다음 생성에도 남고, JSON 내보내기/가져오기로 보관합니다. 서버 저장과 공개 목록은 바꾸지 않습니다.</p></details>`;
  root.append(dialog);
  const methodReview = createMethodReview(root, signal);
  const collection = createCollectionPanel(
    dialog,
    signal,
    (stage) => {
      openStage(stage);
      dialog.close();
    },
    (stage, methods) => methodReview.show(stage, methods),
    (settings) => {
      (form.elements.namedItem('masteryEnabled') as HTMLInputElement).checked = true;
      (form.elements.namedItem('masteryGroups') as HTMLSelectElement).value = String(
        settings.groups,
      );
      (form.elements.namedItem('masteryPerGroup') as HTMLSelectElement).value = String(
        settings.perGroup,
      );
      form.querySelector<HTMLDetailsElement>('.generator-mastery')!.open = true;
      updateMastery();
    },
  );
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const status = dialog.querySelector<HTMLElement>('[data-generator-status]')!;
  const results = dialog.querySelector<HTMLElement>('[data-generator-results]')!;
  const stop = dialog.querySelector<HTMLButtonElement>('[data-generator-stop]')!;
  let worker: Worker | undefined;
  let report: GenerationReport | undefined;
  let busy = false;
  let difficulty: Difficulty = 'easy';
  function currentMastery(): MasterySettings | undefined {
    if (!(form.elements.namedItem('masteryEnabled') as HTMLInputElement).checked) return;
    return {
      groups: Number(
        (form.elements.namedItem('masteryGroups') as HTMLSelectElement).value,
      ) as MasterySettings['groups'],
      perGroup: Number(
        (form.elements.namedItem('masteryPerGroup') as HTMLSelectElement).value,
      ) as MasterySettings['perGroup'],
    };
  }
  function updateMastery() {
    const settings = currentMastery();
    form.querySelector<HTMLElement>('[data-mastery-settings]')!.hidden = !settings;
    (form.elements.namedItem('count') as HTMLInputElement).disabled = busy || !!settings;
    if (settings) {
      form.querySelector('[data-mastery-outline]')!.innerHTML = masteryFocuses
        .slice(0, settings.groups)
        .map(
          (focus, i) => `<li>${i + 1}묶음: ${focus.title}${i ? ' · 이전 조작 함께 활용' : ''}</li>`,
        )
        .join('');
      form.querySelector('[data-mastery-total]')!.textContent =
        `${settings.groups}묶음 × ${settings.perGroup}개 = ${settings.groups * settings.perGroup}개. 후보가 부족하면 앞 묶음부터 검토 대기로 남깁니다.`;
    }
    collection.configureMastery(settings);
  }
  form.addEventListener(
    'change',
    (event) => {
      if ((event.target as HTMLInputElement).name.startsWith('mastery')) updateMastery();
    },
    { signal },
  );
  const message = (text: string) => (status.textContent = text);
  function freshSeed(previous = 0) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    return seed === previous ? (previous === 0xffffffff ? 1 : previous + 1) : seed;
  }
  (form.elements.namedItem('seed') as HTMLInputElement).value = String(freshSeed());
  function describeDifficulty() {
    form.querySelector('[data-difficulty-description]')!.textContent =
      difficulties[difficulty].description;
  }
  function chooseDifficulty(value: Difficulty) {
    difficulty = value;
    form
      .querySelectorAll<HTMLButtonElement>('[data-difficulty]')
      .forEach((control) =>
        control.setAttribute('aria-pressed', String(control.dataset.difficulty === value)),
      );
    describeDifficulty();
  }
  chooseDifficulty(difficulty);
  (form.elements.namedItem('kind') as HTMLSelectElement).addEventListener(
    'change',
    describeDifficulty,
    { signal },
  );
  function setBusy(value: boolean) {
    busy = value;
    form
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
      .forEach((field) => (field.disabled = value));
    form
      .querySelectorAll<HTMLButtonElement>('[type="submit"]')
      .forEach((b) => (b.disabled = value));
    form
      .querySelectorAll<HTMLButtonElement>('[data-difficulty]')
      .forEach((control) => (control.disabled = value));
    stop.disabled = !value;
    if (!value) updateMastery();
  }
  function stopWorker() {
    worker?.terminate();
    worker = undefined;
    setBusy(false);
  }
  function cancel() {
    if (!busy) return;
    stopWorker();
    message(`생성을 중지했습니다. 확인된 ${report?.candidates.length ?? 0}개 후보는 유지됩니다.`);
  }
  function draw() {
    const candidates = report?.candidates ?? [];
    results.innerHTML = candidates
      .map((candidate, index) => {
        const { stage, recipe } = candidate;
        const mode = recipe.difficulty ?? 'challenge';
        return `<article class="generator-card" data-generator-candidate="${stage.id}">${candidatePreview(candidate)}<div><small class="generator-level">${difficulties[mode].name} · 표면 출발 · 행성 ${stage.bodies.length}개 · ${candidate.assessment.style}</small><h3>${escape(stage.title)}</h3><p>${escape(stage.description)}</p><small>생성 번호 ${candidate.seed} · 후보 ${candidate.index}</small><p>검증한 풀이 방식 ${candidate.methods.length}개 · ${Math.min(...candidate.methods.map((m) => m.actions))}~${Math.max(...candidate.methods.map((m) => m.actions))}단계</p><details><summary>난이도 추정과 검사 결과</summary><p>제작용 추정 ${candidate.assessment.score}/100 · 경로 굽음 ${Math.round(candidate.assessment.routeDegrees)}° · 주변 중력 영향 ${Math.round(candidate.assessment.gravityInfluence * 100)}%</p><p>실제 표면 발사 성공 · 생략 검사 ${candidate.omissions}개 통과<br>출력 ±5%·방향 ±3°·종료 시점 변경 ${candidate.nearbyWins}/${candidate.nearbyTotal}개 성공 · 임의 계획 ${candidate.randomWins}/${candidate.randomTotal}개 성공</p>${candidate.warnings.map((warning) => `<p class="generator-warning">${escape(warning)}</p>`).join('')}</details><div class="generator-actions"><button data-generator-review="${index}">풀이 비교</button><button data-generator-open="${index}">초안으로 열기</button><button data-generator-export="${index}">JSON 내보내기</button></div></div></article>`;
      })
      .join('');
  }
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      try {
        const seedInput = form.elements.namedItem('seed') as HTMLInputElement;
        if ((form.elements.namedItem('freshSeed') as HTMLInputElement).checked)
          seedInput.value = String(freshSeed(Number(seedInput.value)));
        const fields = new FormData(form);
        const request = validateRequest({
          kind: fields.get('kind'),
          count: Number(fields.get('count')),
          seed: Number(fields.get('seed')),
          margin: fields.get('margin'),
          difficulty,
          mastery: currentMastery(),
          progression: (event as SubmitEvent).submitter?.hasAttribute('data-progression') === true,
          planetCount:
            fields.get('planetCount') === 'auto' ? 'auto' : Number(fields.get('planetCount')),
        } as GenerationRequest);
        stopWorker();
        const next = new GeneratorWorker();
        worker = next;
        report = undefined;
        results.replaceChildren();
        setBusy(true);
        message('후보 준비 중…');
        next.onmessage = (event: MessageEvent<GenerationResponse>) => {
          if (worker !== next) return;
          if ('error' in event.data) {
            stopWorker();
            message('생성을 마치지 못했습니다. ' + event.data.error);
            return;
          }
          const previousCount = report?.candidates.length ?? 0;
          report = event.data.report;
          if (previousCount !== report.candidates.length) {
            draw();
            collection.add(report.candidates.slice(previousCount));
          }
          const rejected = Object.values(report.rejected).reduce((sum, n) => sum + n, 0);
          message(
            `${report.phase} · 후보 ${report.candidates.length}/${request.count}개 · 비행 ${report.checked}회 검사 · 제외 ${rejected}개`,
          );
          if (report.done) stopWorker();
        };
        next.onerror = () => {
          if (worker !== next) return;
          stopWorker();
          message('생성 작업을 실행하지 못했습니다. 확인된 후보는 유지됩니다.');
        };
        next.postMessage(request);
      } catch (error) {
        message(String(error));
      }
    },
    { signal },
  );
  dialog.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!target) return;
      if (target.dataset.difficulty && !busy)
        chooseDifficulty(target.dataset.difficulty as Difficulty);
      if (target.hasAttribute('data-generator-close')) dialog.close();
      if (target.hasAttribute('data-generator-stop')) cancel();
      if (target.dataset.generatorReview !== undefined) {
        const c = report?.candidates[Number(target.dataset.generatorReview)];
        if (c) methodReview.show(c.stage, c.methods);
        return;
      }
      const action = target.dataset.generatorOpen ?? target.dataset.generatorExport;
      if (action === undefined) return;
      const candidate = report?.candidates[Number(action)];
      if (!candidate) return;
      try {
        const stage = parseStage(structuredClone(candidate.stage));
        stage.published = false;
        if (target.hasAttribute('data-generator-open')) {
          openStage(stage);
          dialog.close();
        } else {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(stage, null, 2) + '\n'], { type: 'application/json' }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = stage.id + '.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } catch (error) {
        message(String(error));
      }
    },
    { signal },
  );
  dialog.addEventListener('close', cancel, { signal });
  dialog.addEventListener(
    'close',
    () => {
      collection.stop();
      methodReview.close();
    },
    { signal },
  );
  dialog.addEventListener('keydown', (event) => event.stopPropagation(), { signal });
  button.addEventListener('click', () => dialog.showModal(), { signal });
  root.addEventListener('workspace-suspend', cancel, { signal });
  signal.addEventListener(
    'abort',
    () => {
      stopWorker();
      dialog.remove();
      button.remove();
    },
    { once: true },
  );
}
