import { controls, escape, readSaved, writeSaved, type App, type Screen } from '../../app/core.ts';
import './hub.css';
import { practiceGroups } from './progress';

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
    const drills = practiceGroups
      .map((g, i) => `<li><span>${i + 1}</span>${escape(g.title)}</li>`)
      .join('');
    app.root.innerHTML = `<main class="menu-sheet wide tutorial-hub"><span class="eyebrow">훈련</span><h1>튜토리얼</h1><div class="tutorial-grid">${app.tutorials
      .map(
        (stage) =>
          `<button class="tutorial-card ${completed.has(stage.id) ? 'done' : ''}" data-stage="${stage.id}"><strong>${escape(stage.title)}</strong><ol class="tutorial-drills">${drills}</ol><small>${completed.has(stage.id) ? '수료 · 다시 연습' : '훈련 시작 ▶'}</small>${completed.has(stage.id) ? '<span class="tutorial-stamp">수료</span>' : ''}</button>`,
      )
      .join('')}</div><button id="back">← 처음 화면</button></main>`;
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
