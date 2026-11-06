import { paintBody } from '../render/body-art';
import type { Body } from '../world/types';
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
  app.root.innerHTML = `<canvas class="space" aria-hidden="true"></canvas><main class="title-menu"><h1 class="game-title"><span class="title-main">${t('app.name')}</span><span class="title-sub">궤도 비행 계획</span></h1><nav class="title-console panel" aria-label="관제실">${resume ? `<button id="continue" class="primary">${escape(t('title.continue', { mission: resume.title }))}</button>` : ''}${firstRun ? `<button id="first-flight" class="primary">첫 비행 훈련</button>` : ''}<button id="start" class="${resume || firstRun ? '' : 'primary'}">${t('title.start')} </button>${firstRun ? '' : `<button id="tutorials">${t('title.tutorial')}</button>`}<div class="button-pair"><button id="help">${t('title.help')}</button><button id="settings">${t('title.settings')}</button></div><div class="title-quiet"><button id="fullscreen" class="quiet">${t('title.fullscreen')}</button><button id="credits" class="quiet">${t('title.credits')}</button>${desktop ? `<button id="quit" class="quiet">${t('title.quit')}</button>` : ''}</div></nav></main><dialog id="credits-dialog" class="ui-dialog ui-doc credits"><h2 class="ui-h2">${t('credits.title')}</h2><p class="ui-body">IP_sasa 팀이 만든 2D 궤도 퍼즐입니다.</p><ul class="ui-body"><li>기획·스테이지·프로그래밍: IP_sasa</li><li>글꼴: Pretendard (길형진, SIL Open Font License 1.1)</li><li>효과음: 게임 안에서 실시간 합성</li></ul><form method="dialog"><button class="ui-btn primary">${t('common.close')}</button></form></dialog><aside class="title-art" aria-hidden="true"><svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="title-shade" cx="0.32" cy="0.28" r="0.85"><stop offset="0" stop-color="#7fa89a"/><stop offset="0.55" stop-color="#3f6a63"/><stop offset="1" stop-color="#14262b"/></radialGradient><linearGradient id="title-air" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ade0f7" stop-opacity=".9"/><stop offset="1" stop-color="#5eb2e8" stop-opacity="0"/></linearGradient></defs><g transform="rotate(-18 830 760)"><path id="title-orbit-path" d="M260 760a570 470 0 1 1 1140 0a570 470 0 1 1-1140 0" fill="none" stroke="#f2b54a" stroke-opacity=".5" stroke-width="1.4" stroke-dasharray="7 7"/><g class="title-rocket">${motion}<g transform="scale(0.9) translate(-30 -6)"><path d="M0 6h9" stroke="#f9d993" stroke-width="3" stroke-linecap="round"/><rect x="10" y="2" width="16" height="8" rx="1.5" fill="#ef8a3c"/><rect x="26" y="2" width="14" height="8" rx="1.5" fill="#a084d8"/><path d="M40 2h8l8 4-8 4h-8z" fill="#eef1ea"/></g></g></g><image id="title-planet" x="440" y="370" width="780" height="780"/></svg></aside>`;
  paintTitlePlanet(app.root);
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

/** The home planet, painted with the same hand-made kit as the bodies in flight. */
function paintTitlePlanet(root: HTMLElement) {
  const image = root.querySelector('#title-planet');
  if (!image) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 780;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.translate(390, 390);
  paintBody(
    ctx,
    {
      id: 'title-home',
      name: '지구',
      kind: 'planet',
      color: '#4f86b8',
      radius: 1,
      mu: 1,
      position: { x: 0, y: 0 },
    } as Body,
    370,
  );
  image.setAttribute('href', canvas.toDataURL());
}
