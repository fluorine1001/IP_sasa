import { controls, type App, type Screen } from '../app/core.ts';
import { backdrop, prepare } from '../render/world.ts';
export function titleScreen(app: App): Screen {
  const abort = new AbortController();
  const still =
    app.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The rocket follows the drawn orbit; with reduced motion it simply rests on it.
  const motion = still
    ? '<animateMotion dur="1s" fill="freeze" keyPoints="0.18;0.18" keyTimes="0;1" calcMode="linear" rotate="auto"><mpath href="#title-orbit-path"/></animateMotion>'
    : '<animateMotion dur="28s" repeatCount="indefinite" rotate="auto"><mpath href="#title-orbit-path"/></animateMotion>';
  app.root.innerHTML = `<canvas class="space" aria-hidden="true"></canvas><main class="title-menu"><h1 class="game-title" aria-label="로켓 응답 없음"><span class="title-main">로켓</span><span class="title-hang">(응답 없음)</span></h1><p class="title-tagline">발사 후엔 계획만 듣는다</p><div class="title-plan" aria-hidden="true"><i class="ignite">발사 100%</i><i class="turn">회전 45°</i><i class="separate">1단 분리</i><i class="ignite">출력 60%</i></div><nav class="title-console panel" aria-label="관제실"><span class="console-tape">관제실</span><button id="start" class="primary">탐사 시작 <span>▶</span></button><button id="tutorials">튜토리얼</button><div class="button-pair"><button id="help">비행 안내서</button><button id="settings">설정</button></div><button id="fullscreen" class="quiet">전체 화면</button></nav></main><aside class="title-planet"><div class="planet-art"></div><svg class="title-tower" viewBox="0 0 40 70" aria-hidden="true"><path d="M8 68V14M32 68V14M8 24l24 14M32 24L8 38M8 44l24 14M32 44L8 58" stroke="#0d171c" stroke-width="4" fill="none"/><path d="M8 68V14M32 68V14M8 24l24 14M32 24L8 38M8 44l24 14M32 44L8 58" stroke="#c7b484" stroke-width="2" fill="none"/><rect x="2" y="6" width="36" height="9" rx="2" fill="#dd4f3b" stroke="#0d171c" stroke-width="3"/></svg><svg class="title-orbit" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(30 50 50)"><path id="title-orbit-path" d="M-18 50a68 37.4 0 1 0 136 0a68 37.4 0 1 0-136 0" fill="none" stroke="#c7b48499" stroke-width="0.6" stroke-dasharray="2 2"/><g class="title-rocket">${motion}<g transform="scale(0.24) translate(-32 -12)"><path d="M2 12h8" stroke="#f2b54a" stroke-width="5" stroke-linecap="round"/><path d="M4 12h5" stroke="#fff1c9" stroke-width="2.5" stroke-linecap="round"/><rect x="10" y="6" width="14" height="12" rx="2" fill="#ef8a3c" stroke="#0d171c" stroke-width="2.5"/><rect x="24" y="6" width="14" height="12" rx="2" fill="#a084d8" stroke="#0d171c" stroke-width="2.5"/><path d="M38 6h12l10 6-10 6H38z" fill="#f0e3c0" stroke="#0d171c" stroke-width="2.5" stroke-linejoin="round"/><path d="M12 6l-3-4h6zM12 18l-3 4h6z" fill="#3c4b51" stroke="#0d171c" stroke-width="2" stroke-linejoin="round"/></g></g></g></svg></aside>`;
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
    button.textContent = document.fullscreenElement ? '전체 화면 해제' : '전체 화면';
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
