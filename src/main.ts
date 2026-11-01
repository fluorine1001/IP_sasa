import './style.css';
import { inertialScroll } from './app/inertial-scroll';
import {
  readSaved,
  writeSaved,
  type App,
  type Screen,
  type ScreenName,
  type PlayArgs,
  type Settings,
} from './app/core.ts';
import { titleScreen } from './screens/title.ts';
import { helpScreen } from './screens/tutorial/screen.ts';
import { settingsScreen } from './screens/settings/screen.ts';
import { stagesScreen } from './screens/stages.ts';
import { tutorialsScreen } from './screens/tutorial/hub.ts';
import { playScreen } from './screens/flight/screen.ts';
import { tutorialCatalog } from './stages/catalog.ts';
import { liveCatalog } from './stages/live-catalog';
import './app/expedition-theme.css';
import './app/console-theme.css';
import './app/console-readability.css';
import './app/console-timeline.css';
import './app/console-panels.css';
// Scopes the illustrated mission-control theme to the game (the workshop keeps its own look).
document.body.classList.add('game-ui');
const saved = readSaved<Partial<Settings>>('orbit-settings-v1', {});
const settings: Settings = {
  volume:
    typeof saved.volume === 'number' && Number.isFinite(saved.volume)
      ? Math.max(0, Math.min(1, saved.volume))
      : 0.5,
  grid: saved.grid === true,
  trails: saved.trails !== false,
  reducedMotion: saved.reducedMotion === true,
};
const progress = readSaved<unknown>('orbit-completed-v1', []),
  completed = new Set<string>(
    Array.isArray(progress) ? progress.filter((x) => typeof x === 'string') : [],
  );
let screen: Screen | undefined,
  navigation = 0;
const app: App = {
  root: document.querySelector('#app')!,
  settings,
  tutorials: tutorialCatalog,
  loadTutorials: (signal) => liveCatalog(tutorialCatalog, signal, 'tutorial'),
  completed,
  saveSettings: () => {
    writeSaved('orbit-settings-v1', settings);
    document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  },
  complete: (id) => {
    completed.add(id);
    writeSaved('orbit-completed-v1', [...completed]);
  },
  go: (name: ScreenName, args?: PlayArgs) => {
    const token = ++navigation;
    screen?.dispose?.();
    screen = undefined;
    if (name === 'editor') {
      if (import.meta.env.DEV)
        void import('./editor/screen').then((m) => {
          if (token === navigation) screen = m.editorScreen(app);
        });
      else app.go('title');
      return;
    }
    screen =
      name === 'title'
        ? titleScreen(app)
        : name === 'help'
          ? helpScreen(app)
          : name === 'settings'
            ? settingsScreen(app)
            : name === 'stages'
              ? stagesScreen(app)
              : name === 'tutorials'
                ? tutorialsScreen(app)
                : playScreen(app, args!);
  },
};
app.saveSettings();
inertialScroll(app.root);
app.go(
  import.meta.env.DEV && new URLSearchParams(location.search).has('editor') ? 'editor' : 'title',
);
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  screen?.frame?.(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
