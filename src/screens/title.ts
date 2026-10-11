import { controls, type App, type Screen } from '../app/core.ts';
import { backdrop, prepare } from '../render/world.ts';
export function titleScreen(app: App): Screen {
  const abort = new AbortController();
  app.root.innerHTML = `<canvas class="space" aria-hidden="true"></canvas><main class="title-menu"><div class="badge">궤도 탐사국 · 비행 퍼즐</div><h1>작은 로켓의<br><span>큰 모험</span></h1><p>끌어당기는 별들 사이에서<br>네가 그린 길을 날아봐.</p><nav><button id="start" class="primary">탐사 시작 <span>▶</span></button><div class="button-pair"><button id="help">비행 안내서</button><button id="settings">설정</button></div><button id="fullscreen" class="quiet">전체 화면 ⛶</button></nav><small>마우스로 길을 그리고, 관측으로 고쳐나가는 우주 퍼즐</small></main><aside class="title-planet"><div class="planet-art"></div><div class="ship-art">▰</div><div class="planet-tag">새 경로를 기다리는 중…</div></aside>`;
  controls(
    app.root,
    {
      start: () => app.go('stages'),
      help: () => app.go('help'),
      settings: () => app.go('settings'),
      fullscreen: () => {
        void document.documentElement.requestFullscreen?.().catch(() => {});
      },
    },
    abort.signal,
  );
  const canvas = app.root.querySelector('canvas')!;
  return {
    frame: () => {
      const { ctx, w, h } = prepare(canvas);
      backdrop(ctx, w, h, { x: 0, y: 0, zoom: 1 });
    },
    dispose: () => abort.abort(),
  };
}
