import './style.css';
import { controls, type App, type Screen } from '../../app/core.ts';
export function settingsScreen(app: App): Screen {
  const abort = new AbortController(),
    s = app.settings;
  app.root.innerHTML = `<main class="menu-sheet narrow"><h1>설정</h1><label class="setting">효과음 <input id="volume" type="range" min="0" max="1" step=".05" value="${s.volume}"></label>${(
    [
      ['grid', '좌표 격자', '지도에 거리 눈금을 깝니다'],
      ['trails', '지나온 궤적', '비행한 경로를 선으로 남깁니다'],
      ['reducedMotion', '장식 움직임 줄이기', '도장·알림·궤도 애니메이션을 끕니다'],
    ] as const
  )
    .map(
      ([id, text, hint]) =>
        `<label class="setting"><span>${text}<small>${hint}</small></span><input id="${id}" type="checkbox" ${s[id] ? 'checked' : ''}></label>`,
    )
    .join('')}<button id="back" class="primary">← 처음 화면</button></main>`;
  app.root.addEventListener(
    'input',
    () => {
      s.volume = Number((app.root.querySelector('#volume') as HTMLInputElement).value);
      for (const k of ['grid', 'trails', 'reducedMotion'] as const)
        s[k] = (app.root.querySelector(`#${k}`) as HTMLInputElement).checked;
      app.saveSettings();
    },
    { signal: abort.signal },
  );
  controls(app.root, { back: () => app.go('title') }, abort.signal);
  return { dispose: () => abort.abort() };
}
