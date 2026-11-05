import { controls, escape, readSaved, writeSaved, type App, type Screen } from '../app/core.ts';
import { t } from '../i18n';
import { continueRequest, nextMission } from './stages';
import { backdrop, prepare } from '../render/world.ts';
export function titleScreen(app: App): Screen {
  const abort = new AbortController();
  const firstRun = !readSaved<boolean>('apollo-first-run-v1', false);
  const resume = nextMission(app);
  const desktop = /Electron/.test(navigator.userAgent);
  const still =
    app.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The rocket follows the drawn orbit; with reduced motion it simply rests on it.
  const motion = still
    ? '<animateMotion dur="1s" fill="freeze" keyPoints="0.18;0.18" keyTimes="0;1" calcMode="linear" rotate="auto"><mpath href="#title-orbit-path"/></animateMotion>'
    : '<animateMotion dur="28s" repeatCount="indefinite" rotate="auto"><mpath href="#title-orbit-path"/></animateMotion>';
  app.root.innerHTML = `<canvas class="space" aria-hidden="true"></canvas><main class="title-menu"><h1 class="game-title"><span class="title-main">${t('app.name')}</span></h1><p class="title-tagline">${t('app.tagline')}</p><ol class="title-pitch" aria-label="게임 흐름"><li><b>1</b>${t('title.pitch1')}</li><li><b>2</b>${t('title.pitch2')}</li><li><b>3</b>${t('title.pitch3')}</li></ol><nav class="title-console panel" aria-label="관제실"><span class="console-tape">관제실</span>${resume ? `<button id="continue" class="primary">${escape(t('title.continue', { mission: resume.title }))} <span>▶</span></button>` : ''}${firstRun ? `<button id="first-flight" class="primary">첫 비행 훈련 <small>처음이라면 여기부터</small> <span>▶</span></button>` : ''}<button id="start" class="${resume || firstRun ? '' : 'primary'}">${t('title.start')} ${resume || firstRun ? '' : '<span>▶</span>'}</button>${firstRun ? '' : `<button id="tutorials">${t('title.tutorial')}</button>`}<div class="button-pair"><button id="help">${t('title.help')}</button><button id="settings">${t('title.settings')}</button></div><div class="title-quiet"><button id="fullscreen" class="quiet">${t('title.fullscreen')}</button><button id="credits" class="quiet">${t('title.credits')}</button>${desktop ? `<button id="quit" class="quiet">${t('title.quit')}</button>` : ''}</div></nav></main><dialog id="credits-dialog" class="ui-dialog ui-doc credits"><h2 class="ui-h2">${t('credits.title')}</h2><p class="ui-body">IP_sasa 팀이 만든 2D 궤도 퍼즐입니다.</p><ul class="ui-body"><li>기획·스테이지·프로그래밍: IP_sasa</li><li>글꼴: Pretendard (길형진, SIL Open Font License 1.1)</li><li>효과음: 게임 안에서 실시간 합성</li></ul><form method="dialog"><button class="ui-btn primary">${t('common.close')}</button></form></dialog><aside class="title-planet"><div class="planet-art"></div><svg class="title-tower" viewBox="0 0 40 70" aria-hidden="true"><path d="M8 68V14M32 68V14M8 24l24 14M32 24L8 38M8 44l24 14M32 44L8 58" stroke="#0d171c" stroke-width="4" fill="none"/><path d="M8 68V14M32 68V14M8 24l24 14M32 24L8 38M8 44l24 14M32 44L8 58" stroke="#c7b484" stroke-width="2" fill="none"/><rect x="2" y="6" width="36" height="9" rx="2" fill="#dd4f3b" stroke="#0d171c" stroke-width="3"/></svg><svg class="title-orbit" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(30 50 50)"><path id="title-orbit-path" d="M-18 50a68 37.4 0 1 0 136 0a68 37.4 0 1 0-136 0" fill="none" stroke="#c7b48499" stroke-width="0.6" stroke-dasharray="2 2"/><g class="title-rocket">${motion}<g transform="scale(0.24) translate(-32 -12)"><path d="M2 12h8" stroke="#f2b54a" stroke-width="5" stroke-linecap="round"/><path d="M4 12h5" stroke="#fff1c9" stroke-width="2.5" stroke-linecap="round"/><rect x="10" y="6" width="14" height="12" rx="2" fill="#ef8a3c" stroke="#0d171c" stroke-width="2.5"/><rect x="24" y="6" width="14" height="12" rx="2" fill="#a084d8" stroke="#0d171c" stroke-width="2.5"/><path d="M38 6h12l10 6-10 6H38z" fill="#f0e3c0" stroke="#0d171c" stroke-width="2.5" stroke-linejoin="round"/><path d="M12 6l-3-4h6zM12 18l-3 4h6z" fill="#3c4b51" stroke="#0d171c" stroke-width="2" stroke-linejoin="round"/></g></g></g></svg></aside>`;
  controls(
    app.root,
    {
      start: () => {
        writeSaved('apollo-first-run-v1', true);
        app.go('stages');
      },
      'first-flight': () => {
        writeSaved('apollo-first-run-v1', true);
        app.go('tutorials');
      },
      continue: () => {
        continueRequest.pending = true;
        app.go('stages');
      },
      credits: () => app.root.querySelector<HTMLDialogElement>('#credits-dialog')!.showModal(),
      quit: () => window.close(),
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
