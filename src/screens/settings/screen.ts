import './style.css';
import { controls, readSaved, writeSaved, type App, type Screen } from '../../app/core.ts';
import { t, type StringKey } from '../../i18n';
import { eventSound, uiSound } from '../../audio/engine';

type Slider = { id: 'volume' | 'sfxVolume' | 'uiVolume' | 'ambienceVolume'; label: StringKey };
type Toggle = {
  id: 'grid' | 'trails' | 'reducedMotion' | 'orbitTool';
  label: StringKey;
  hint: StringKey;
};
const sliders: Slider[] = [
  { id: 'volume', label: 'settings.master' },
  { id: 'sfxVolume', label: 'settings.sfx' },
  { id: 'uiVolume', label: 'settings.ui' },
  { id: 'ambienceVolume', label: 'settings.ambience' },
];
const display: Toggle[] = [
  { id: 'grid', label: 'settings.grid', hint: 'settings.gridHint' },
  { id: 'trails', label: 'settings.trails', hint: 'settings.trailsHint' },
  { id: 'reducedMotion', label: 'settings.reducedMotion', hint: 'settings.reducedMotionHint' },
];
const RESET_KEYS = [
  'orbit-completed-v1',
  'orbit-medals-v1',
  'apollo-briefed-v1',
  'apollo-first-run-v1',
  'orbit-chapter-v1',
];

export function settingsScreen(app: App): Screen {
  const abort = new AbortController(),
    s = app.settings;
  const percent = (v: number) => `${Math.round(v * 100)}%`;
  const slider = ({ id, label }: Slider) =>
    `<label class="setting slider"><span>${t(label)}</span><input id="${id}" type="range" min="0" max="1" step=".05" value="${s[id] ?? 0}"><output for="${id}">${percent(s[id] ?? 0)}</output></label>`;
  const toggle = ({ id, label, hint }: Toggle) =>
    `<label class="setting"><span>${t(label)}<small>${t(hint)}</small></span><input id="${id}" type="checkbox" ${s[id] ? 'checked' : ''}></label>`;
  const briefing = readSaved<boolean>('apollo-briefing-auto', true) !== false;
  app.root.innerHTML = `<main class="menu-sheet narrow settings-sheet"><h1>${t('settings.title')}</h1>
<section class="settings-group"><h2>${t('settings.sound')}</h2>${sliders.map(slider).join('')}</section>
<section class="settings-group"><h2>${t('settings.display')}</h2><label class="setting slider"><span>${t('settings.uiScale')}</span><input id="uiScale" type="range" min="0.85" max="1.25" step="0.05" value="${s.uiScale ?? 1}"><output for="uiScale">${percent(s.uiScale ?? 1)}</output></label>${display.map(toggle).join('')}</section>
<section class="settings-group"><h2>${t('settings.play')}</h2>${toggle({ id: 'orbitTool', label: 'settings.orbitTool', hint: 'settings.orbitToolHint' })}<label class="setting"><span>${t('settings.briefing')}<small>${t('settings.briefingHint')}</small></span><input id="briefingAuto" type="checkbox" ${briefing ? 'checked' : ''}></label></section>
<section class="settings-group"><h2>${t('settings.data')}</h2><div class="setting"><span>${t('settings.reset')}<small>${t('settings.resetHint')}</small></span><button id="reset-progress" class="ui-btn danger sm">${t('settings.reset')}</button></div></section>
<button id="back" class="ui-btn">← ${t('common.back')}</button></main>`;
  const input = (id: string) => app.root.querySelector<HTMLInputElement>('#' + id)!;
  app.root.addEventListener(
    'input',
    (e) => {
      for (const { id } of sliders) s[id] = Number(input(id).value);
      s.uiScale = Number(input('uiScale').value);
      for (const { id } of display) s[id] = input(id).checked;
      s.orbitTool = input('orbitTool').checked;
      writeSaved('apollo-briefing-auto', input('briefingAuto').checked);
      for (const out of app.root.querySelectorAll<HTMLOutputElement>('output[for]'))
        out.value = percent(Number(input(out.htmlFor.value).value));
      app.saveSettings();
      const target = (e.target as HTMLElement).id;
      if (target === 'sfxVolume' || target === 'volume') eventSound('goal');
      else if (target === 'uiVolume') uiSound('click');
    },
    { signal: abort.signal },
  );
  let armed = false;
  controls(
    app.root,
    {
      back: () => app.go('title'),
      'reset-progress': () => {
        const button = input('reset-progress');
        if (!armed) {
          armed = true;
          button.textContent = t('settings.resetConfirm');
          return;
        }
        for (const key of RESET_KEYS) localStorage.removeItem(key);
        app.completed.clear();
        button.textContent = t('settings.resetDone');
        button.disabled = true;
      },
    },
    abort.signal,
  );
  return { dispose: () => abort.abort() };
}
