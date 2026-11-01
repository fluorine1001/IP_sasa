import { controls, escape, readSaved, writeSaved, type App, type Screen } from '../app/core.ts';
import { campaignChapters } from '../stages/chapters';
import './campaign.css';
import { catalog } from '../stages/catalog.ts';
import { liveCatalog } from '../stages/live-catalog';
export function stagesScreen(app: App): Screen {
  const abort = new AbortController();
  let available: import('../world/types').Stage[] = catalog;
  let selected = readSaved<string>('orbit-chapter-v1', 'departure');
  function draw() {
    const chapters = campaignChapters(available, app.completed);
    // The embedded catalog may arrive before a user's server-only chapter.
    // Render a fallback without overwriting their actual selection.
    const visibleChapter = chapters.some((c) => c.id === selected)
      ? selected
      : (chapters[0]?.id ?? '');
    const total = chapters.reduce((n, c) => n + c.stages.length, 0),
      done = chapters.reduce((n, c) => n + c.completed, 0);
    app.root.innerHTML = `<main class="campaign menu-sheet wide"><header class="campaign-header"><div><span class="eyebrow">FLIGHT ATLAS / 항해 지도</span><h1>탐사 임무</h1></div><div class="campaign-total"><b>${done}<span> / ${total}</span></b><small>완료한 임무</small></div><button id="back" class="quiet">← 기지</button></header>
      <nav class="chapter-map" aria-label="챕터 선택">${chapters.map((c, i) => `<button data-chapter="${escape(c.id)}" class="chapter-card ${c.id === visibleChapter ? 'selected' : ''}" aria-pressed="${c.id === visibleChapter}" style="--chapter-accent:${c.color}"><span class="chapter-planet" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span class="chapter-caption"><small>CHAPTER ${String(i + 1).padStart(2, '0')}</small><strong>${escape(c.title)}</strong><span>${escape(c.subtitle)}</span><span class="chapter-progress"><i style="width:${(c.completed / Math.max(1, c.stages.length)) * 100}%"></i></span><small>${c.completed} / ${c.stages.length} 완료</small></span></button>`).join('')}</nav>
      ${chapters.map((c) => `<section class="chapter-missions" ${c.id !== visibleChapter ? 'hidden' : ''}><header><h2>${escape(c.title)}</h2><span>${c.stages.length}개의 항로</span></header><div class="stage-grid mission-route">${c.stages.map((s, i) => `<button class="stage-card ${app.completed.has(s.id) ? 'completed' : ''}" data-stage="${s.id}" style="--mission-color:${escape(s.bodies[0]?.color ?? '#84bbd0')}"><span class="stage-number">${app.completed.has(s.id) ? '✓' : String(i + 1).padStart(2, '0')}</span><span class="stage-orb" aria-hidden="true"></span><strong>${escape(s.title)}</strong><small>${app.completed.has(s.id) ? '완료 · 다시 도전' : '항로 선택'}</small></button>`).join('')}</div></section>`).join('')}
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
    app.root
      .querySelectorAll<HTMLButtonElement>('[data-stage]')
      .forEach((b) =>
        b.addEventListener(
          'click',
          () => app.go('play', { stage: available.find((s) => s.id === b.dataset.stage)! }),
          { signal: abort.signal },
        ),
      );
  }
  draw();
  void liveCatalog(catalog, abort.signal).then((stages) => {
    if (!abort.signal.aborted) {
      available = stages;
      draw();
    }
  });
  return { dispose: () => abort.abort() };
}
