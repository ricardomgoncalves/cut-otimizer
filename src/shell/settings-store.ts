// Machine settings are global to the browser: kept in localStorage, read back through parseSettings
// so a missing, older or hand-edited entry still loads. (The Job store, #29, holds each Job's snapshot.)
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../core/settings.ts';

const KEY = 'cut-optimizer.machine-settings';

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return text === null ? DEFAULT_SETTINGS : parseSettings(JSON.parse(text));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Returns false when the browser would not store them (they still apply for this page). */
export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
