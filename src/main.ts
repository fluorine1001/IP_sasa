import './ui/tokens.css';
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
import { installAudio, installUiSounds, setVolumes } from './audio/engine';
import './app/expedition-theme.css';
import './app/console-theme.css';
import './app/console-readability.css';
import './app/console-timeline.css';
import './app/console-panels.css';
// Scopes the illustrated mission-control theme to the game (the workshop keeps its own look).
document.body.classList.add('game-ui');
const saved = readSaved<Partial<Settings>>('orbit-settings-v1', {});
const unit = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const settings: Settings = {
  volume: unit(saved.volume, 0.7),
  sfxVolume: unit(saved.sfxVolume, 0.8),
  uiVolume: unit(saved.uiVolume, 0.6),
  ambienceVolume: unit(saved.ambienceVolume, 0.5),
  orbitTool: saved.orbitTool !== false,
  uiScale:
    typeof saved.uiScale === 'number' && Number.isFinite(saved.uiScale)
      ? Math.max(0.85, Math.min(1.25, saved.uiScale))
      : 1,
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
    applySettings();
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
function applySettings() {
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  setVolumes({
    master: settings.volume,
    sfx: settings.sfxVolume,
    ui: settings.uiVolume,
    ambience: settings.ambienceVolume,
  });
}
installAudio({
  master: settings.volume,
  sfx: settings.sfxVolume,
  ui: settings.uiVolume,
  ambience: settings.ambienceVolume,
});
installUiSounds(app.root);
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
