import '../style.css';
import { inertialScroll } from '../app/inertial-scroll';
import { editorScreen } from './screen';
import { playScreen } from '../screens/flight/screen';
import { readSaved, type App, type Screen, type Settings } from '../app/core';
import { editorCredentials } from './credentials';
const settings = readSaved<Settings>('orbit-settings-v1', {
  volume: 0.5,
  grid: true,
  trails: true,
  reducedMotion: false,
});
let current: Screen | undefined;
const app: App = {
  root: document.querySelector('#app')!,
  settings,
  tutorials: [],
  completed: new Set(),
  saveSettings() {},
  complete() {},
  go(name, args) {
    current?.dispose?.();
    if (name === 'title') {
      location.href = '/';
      return;
    }
    current = name === 'play' && args ? playScreen(app, args) : editorScreen(app);
  },
};
async function unlock() {
  const response = await fetch('/api/workshop/stages', {
    headers: editorCredentials.key ? { Authorization: 'Bearer ' + editorCredentials.key } : {},
  }).catch(() => undefined);
  if (response?.ok) {
    app.go('editor');
    return;
  }
  app.root.innerHTML =
    '<main class="menu-sheet"><h1>제작소 접속</h1><label>편집 키<input id="editor-key" type="password" autocomplete="off"></label><button id="editor-unlock">접속</button><p id="editor-login-status">서버 관리자의 편집 키가 필요합니다. 게임은 키 없이 이용할 수 있습니다.</p></main>';
  app.root.querySelector('#editor-unlock')!.addEventListener('click', () => {
    editorCredentials.key = app.root.querySelector<HTMLInputElement>('#editor-key')!.value;
    void unlock();
  });
}
document.body.classList.toggle('reduced-motion', settings.reducedMotion);
void unlock();
inertialScroll(app.root);
let previous = performance.now();
function frame(now: number) {
  current?.frame?.(Math.min(0.05, (now - previous) / 1000));
  previous = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
