import { medalBadge } from '../ui/figures';
import { controls, escape, readSaved, writeSaved, type App, type Screen } from '../app/core.ts';
import { campaignChapters, chapterOf } from '../stages/chapters';
import './campaign.css';
import { catalog } from '../stages/catalog.ts';
import { liveCatalog } from '../stages/live-catalog';
import { readMedals } from '../app/records';
import type { Stage } from '../world/types';
import { objectiveGoals } from '../world/goals';

/** The question each chapter lets the player discover; never the answer. */
const CHAPTER_QUESTION: Record<string, string> = {
  departure: '옆으로 얼마나 빨라야 떨어지지 않을까?',
  expedition: '움직이는 천체는 지나가는 로켓을 어떻게 바꿀까?',
  operations: '앞선 물체를 따라잡으려면 더 빨리 가야 할까?',
};

function vehicleLabel(stage: Stage) {
  const parts = stage.rocket?.parts.length ?? 0;
  return parts === 0 ? '냉가스 기체' : parts === 1 ? '1단 로켓' : parts + '단 로켓';
}
/** What a mission asks the player to handle, as short tags read before choosing it. */
function missionTags(stage: Stage) {
  const goals = JSON.stringify(stage.goals);
  return [
    vehicleLabel(stage),
    stage.bodies.some((b) => b.atmosphere && b.atmosphere.density > 0) ? '대기권' : '',
    /"(landed|touchdown\w*|landingSpeed)"/.test(goals) ? '착륙' : '',
    stage.rocket?.payloads?.length ? '위성 분리' : '',
    stage.bodies.filter((b) => b.kind !== 'barycenter').length > 1 ? '여러 천체' : '',
    stage.bodies.some((b) => b.hiddenGravity) ? '중력 측정' : '',
  ].filter(Boolean);
}
/** Set by the title's 이어하기: the campaign opens the first unfinished mission. */
export const continueRequest = { pending: false };
/** First unfinished campaign mission in order, if the player has started at all. */
export function nextMission(app: App) {
  const chapters = campaignChapters(catalog, app.completed);
  const order = chapters.flatMap((c) => c.stages);
  if (!order.some((s) => app.completed.has(s.id))) return undefined;
  return order.find((s) => !app.completed.has(s.id));
}
export function stagesScreen(app: App): Screen {
  const abort = new AbortController();
  let available: import('../world/types').Stage[] = catalog;
  let selected = readSaved<string>('orbit-chapter-v1', 'departure');
  const resume = continueRequest.pending ? nextMission(app) : undefined;
  if (resume) selected = chapterOf(resume).id;
  function draw() {
    const chapters = campaignChapters(available, app.completed);
    // The embedded catalog may arrive before a user's server-only chapter.
    // Render a fallback without overwriting their actual selection.
    const visibleChapter = chapters.some((c) => c.id === selected)
      ? selected
      : (chapters[0]?.id ?? '');
    const total = chapters.reduce((n, c) => n + c.stages.length, 0),
      done = chapters.reduce((n, c) => n + c.completed, 0);
    const medals = readMedals();
    const recommended = chapters.flatMap((c) => c.stages).find((s) => !app.completed.has(s.id))?.id;
    const missionCard = (s: Stage, i: number) => {
      const done = app.completed.has(s.id),
        m = medals[s.id];
      const status = !done
        ? '미도전'
        : m?.clean
          ? '무손상 성공'
          : m?.budget
            ? '예산 안 성공'
            : '성공';
      // The goal is worth reading before choosing; the medals say what is left to earn.
      const goals = objectiveGoals(s).map((g) => g.title);
      const goal = goals.length
        ? `<span class="stage-goal"><b>목표</b>${escape(goals[0])}${goals.length > 1 ? ` <em>외 ${goals.length - 1}개</em>` : ''}</span>`
        : '';
      const next = s.id === recommended;
      return `<button class="stage-card ${done ? 'completed' : ''} ${next ? 'recommended' : ''}" data-stage="${s.id}">${next ? '<span class="stage-next">다음 추천</span>' : ''}<span class="stage-number">${String(i + 1).padStart(2, '0')}</span><strong>${escape(s.title)}</strong>${goal}<span class="stage-tags">${missionTags(
        s,
      )
        .map((tag, k) => `<span class="${k ? 'tag' : 'stage-vehicle'}">${escape(tag)}</span>`)
        .join(
          '',
        )}</span><span class="stage-medals" aria-label="메달: 성공 ${done ? '받음' : '없음'}, 예산 안 ${m?.budget ? '받음' : '없음'}, 무손상 ${m?.clean ? '받음' : '없음'}">${medalBadge('success', done, 30)}${medalBadge('budget', !!m?.budget, 30)}${medalBadge('clean', !!m?.clean, 30)}</span><small class="stage-status">${status}</small></button>`;
    };
    app.root.innerHTML = `<main class="campaign menu-sheet wide"><header class="campaign-header"><div><span class="eyebrow">항해 지도</span><h1>탐사 임무</h1></div><div class="campaign-total"><b>${done}<span> / ${total}</span></b><small>완료한 임무</small></div><button id="back" class="quiet">← 처음 화면</button></header>
      <nav class="chapter-map" aria-label="챕터 선택">${chapters.map((c, i) => `<button data-chapter="${escape(c.id)}" class="chapter-card ${c.id === visibleChapter ? 'selected' : ''}" aria-pressed="${c.id === visibleChapter}" style="--chapter-accent:${c.color}"><span class="chapter-planet" aria-hidden="true">${i + 1}</span><span class="chapter-caption"><small>${i + 1}장</small><strong>${escape(c.title)}</strong><span>${escape(c.subtitle)}</span><span class="chapter-progress"><i style="width:${(c.completed / Math.max(1, c.stages.length)) * 100}%"></i></span><small>${c.completed} / ${c.stages.length} 완료</small></span></button>`).join('')}</nav>
      ${chapters.map((c) => `<section class="chapter-missions" ${c.id !== visibleChapter ? 'hidden' : ''} style="--chapter-accent:${c.color}"><header><h2>${escape(c.title)}</h2>${CHAPTER_QUESTION[c.id] ? `<p class="chapter-question">${escape(CHAPTER_QUESTION[c.id])}</p>` : ''}<p class="medal-legend"><span>${medalBadge('success', true, 24)}성공</span><span>${medalBadge('budget', true, 24)}연료 90% 이하</span><span>${medalBadge('clean', true, 24)}하중 한계 미만</span></p></header><div class="stage-grid mission-route">${c.stages.map(missionCard).join('')}</div></section>`).join('')}
      ${!chapters.length ? '<p>공개된 임무가 아직 없습니다.</p>' : ''}</main>`;
    controls(app.root, { back: () => app.go('title') }, abort.signal);
    app.root.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((b) =>
      b.addEventListener(
        'click',
        () => {
          selected = b.dataset.chapter!;
          writeSaved('orbit-chapter-v1', selected);
          draw();
        },
        { signal: abort.signal },
      ),
    );
    // Campaign order across chapters; the result card's "다음 임무" follows it.
    const order = chapters.flatMap((c) => c.stages.map((s) => ({ stage: s, chapter: c.id })));
    const open = (index: number) => {
      const entry = order[index];
      if (!entry) return;
      if (entry.chapter !== selected) writeSaved('orbit-chapter-v1', entry.chapter);
      app.go('play', {
        stage: entry.stage,
        next: index + 1 < order.length ? () => open(index + 1) : undefined,
      });
    };
    app.root
      .querySelectorAll<HTMLButtonElement>('[data-stage]')
      .forEach((b) =>
        b.addEventListener(
          'click',
          () => open(order.findIndex((o) => o.stage.id === b.dataset.stage)),
          { signal: abort.signal },
        ),
      );
  }
  draw();
  if (continueRequest.pending) {
    continueRequest.pending = false;
    app.root.querySelector<HTMLButtonElement>(`[data-stage="${resume?.id ?? ''}"]`)?.click();
  }
  void liveCatalog(catalog, abort.signal).then((stages) => {
    if (!abort.signal.aborted) {
      available = stages;
      draw();
    }
  });
  return { dispose: () => abort.abort() };
}

/** A solved mission's best numbers: something to beat on the way back. */
