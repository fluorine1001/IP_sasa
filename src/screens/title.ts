import { controls, type App, type Screen } from '../app/core.ts';
import { backdrop, prepare } from '../render/world.ts';
export function titleScreen(app: App): Screen {
  const abort = new AbortController();
  app.root.innerHTML = `<canvas class="space" aria-hidden="true"></canvas><main class="title-menu"><h1>작은 로켓의<br><span>큰 모험</span></h1><nav><button id="start" class="primary">탐사 시작 <span>▶</span></button><button id="tutorials">튜토리얼 스테이지</button><div class="button-pair"><button id="help">비행 안내서</button><button id="settings">설정</button></div><button id="fullscreen" class="quiet">전체 화면 ⛶</button></nav></main><aside class="title-planet"><div class="planet-art"></div><div class="ship-art">▰</div></aside>`;
  controls(
    app.root,
    {
      start: () => app.go('stages'),
      tutorials: () => app.go('tutorials'),
      help: () => app.go('help'),
      settings: () => app.go('settings'),
      fullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      },
    },
    abort.signal,
  );
  const syncFullscreen = () => {
    const button = app.root.querySelector<HTMLButtonElement>('#fullscreen')!;
    button.textContent = document.fullscreenElement ? '전체 화면 해제 ⛶' : '전체 화면 ⛶';
    button.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  };
  document.addEventListener('fullscreenchange', syncFullscreen, { signal: abort.signal });
  syncFullscreen();
  const canvas = app.root.querySelector('canvas')!;
  return {
    frame: () => {
      const { ctx, w, h } = prepare(canvas);
      backdrop(ctx, w, h, { x: 0, y: 0, zoom: 1 });
    },
    dispose: () => abort.abort(),
  };
}
