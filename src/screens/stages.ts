import { controls, escape, type App, type Screen } from '../app/core.ts';
import { catalog } from '../stages/catalog.ts';
import { liveCatalog } from '../stages/live-catalog';
export function stagesScreen(app: App): Screen {
  const abort = new AbortController();
  let available: import('../world/types').Stage[] = catalog;
  function draw() {
    app.root.innerHTML = `<main class="menu-sheet wide"><h1>탐사 임무</h1><div class="stage-grid">${available.map((s, i) => `<button class="stage-card" data-stage="${s.id}"><span class="stage-number">${String(i + 1).padStart(2, '0')}</span><span class="stage-orb" style="background:${escape(s.bodies[0].color)}"></span><strong>${escape(s.title)}</strong><small>${app.completed.has(s.id) ? '✓ 완료' : ''}</small></button>`).join('')}</div><button id="back">기지로 돌아가기</button></main>`;
    controls(app.root, { back: () => app.go('title') }, abort.signal);
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
