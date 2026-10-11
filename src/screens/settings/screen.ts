import './style.css';
import { controls, type App, type Screen } from '../../app/core.ts';
export function settingsScreen(app: App): Screen {
  const abort = new AbortController(),
    s = app.settings;
  app.root.innerHTML = `<main class="menu-sheet narrow"><div class="badge">탐사 장비 설정</div><h1>나에게 맞는 비행</h1><label class="setting">효과음 <input id="volume" type="range" min="0" max="1" step=".05" value="${s.volume}"></label>${(
    [
      ['grid', '좌표 격자'],
      ['trails', '지나온 궤적'],
      ['reducedMotion', '장식 움직임 줄이기'],
    ] as const
  )
    .map(
      ([id, text]) =>
        `<label class="setting">${text}<input id="${id}" type="checkbox" ${s[id] ? 'checked' : ''}></label>`,
    )
    .join(
      '',
    )}<p class="muted">설정은 이 컴퓨터에 저장됩니다.</p><button id="back" class="primary">기지로 돌아가기</button></main>`;
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
