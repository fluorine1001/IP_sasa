import { controls, escape, readSaved, writeSaved, type App, type Screen } from '../../app/core.ts';
import './hub.css';

const PROGRESS_KEY = 'orbit-tutorial-completed-v1';

export function tutorialsScreen(app: App): Screen {
  const abort = new AbortController();
  const saved = readSaved<unknown>(PROGRESS_KEY, []),
    completed = new Set(
      (Array.isArray(saved) ? saved : []).filter(
        (value): value is string => typeof value === 'string',
      ),
    );
  function draw() {
    app.root.innerHTML = `<main class="menu-sheet wide tutorial-hub"><h1>튜토리얼 스테이지</h1><div class="tutorial-grid">${app.tutorials
      .map(
        (stage) =>
          `<button class="tutorial-card ${completed.has(stage.id) ? 'done' : ''}" data-stage="${stage.id}"><span class="tutorial-number">▶</span><strong>${escape(stage.title)}</strong><span class="tutorial-skills">◷ 예약　🚀 비행　▤ 기록 비교</span><small>${completed.has(stage.id) ? '✓ 완료 · 다시 연습' : '▶ 시작'}</small></button>`,
      )
      .join('')}</div><button id="back">기지로 돌아가기</button></main>`;
    controls(app.root, { back: () => app.go('title') }, abort.signal);
    app.root.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((button) =>
      button.addEventListener(
        'click',
        () => {
          const stage = app.tutorials.find((item) => item.id === button.dataset.stage);
          if (!stage) return;
          app.go('play', {
            stage,
            tutorial: true,
            onSolved: () => {
              completed.add(stage.id);
              writeSaved(PROGRESS_KEY, [...completed]);
            },
            onReturn: () => app.go('tutorials'),
          });
        },
        { signal: abort.signal },
      ),
    );
  }
  draw();
  if (app.loadTutorials)
    void app.loadTutorials(abort.signal).then((stages) => {
      if (!abort.signal.aborted) {
        app.tutorials = stages;
        draw();
      }
    });
  return { dispose: () => abort.abort() };
}
