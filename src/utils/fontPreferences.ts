export interface FontPreferences {
  uiFont: string;
  uiFontSize: number;
  editorFont: string;
  editorFontSize: number;
}

export const UI_FONT_PRESETS: Array<{ label: string; value: string }> = [
  {
    label: 'Google Sans (Default)',
    value:
      "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  {
    label: 'Segoe UI (Windows)',
    value: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
  },
  {
    label: 'System Default',
    value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  {
    label: 'Verdana',
    value: "Verdana, 'Segoe UI', sans-serif"
  }
];

export const EDITOR_FONT_PRESETS: Array<{ label: string; value: string }> = [
  {
    label: 'JetBrains Mono (Default)',
    value: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"
  },
  {
    label: 'Cascadia Code',
    value: "'Cascadia Code', Consolas, 'Courier New', monospace"
  },
  {
    label: 'Cascadia Mono',
    value: "'Cascadia Mono', Consolas, 'Courier New', monospace"
  },
  {
    label: 'Consolas',
    value: "Consolas, 'Courier New', monospace"
  },
  {
    label: 'Fira Code',
    value: "'Fira Code', 'Cascadia Code', Consolas, monospace"
  },
  {
    label: 'Courier New',
    value: "'Courier New', monospace"
  }
];

export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
  uiFont: UI_FONT_PRESETS[0].value,
  uiFontSize: 13,
  editorFont: EDITOR_FONT_PRESETS[0].value,
  editorFontSize: 13
};

const STORAGE_KEY = 'gmrv.fontPreferences';

export function loadFontPreferences(): FontPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FONT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<FontPreferences>;
    return {
      uiFont:
        typeof parsed.uiFont === 'string' && parsed.uiFont.trim()
          ? parsed.uiFont
          : DEFAULT_FONT_PREFERENCES.uiFont,
      uiFontSize:
        typeof parsed.uiFontSize === 'number' &&
        parsed.uiFontSize >= 11 &&
        parsed.uiFontSize <= 18
          ? parsed.uiFontSize
          : DEFAULT_FONT_PREFERENCES.uiFontSize,
      editorFont:
        typeof parsed.editorFont === 'string' && parsed.editorFont.trim()
          ? parsed.editorFont
          : DEFAULT_FONT_PREFERENCES.editorFont,
      editorFontSize:
        typeof parsed.editorFontSize === 'number' &&
        parsed.editorFontSize >= 10 &&
        parsed.editorFontSize <= 20
          ? parsed.editorFontSize
          : DEFAULT_FONT_PREFERENCES.editorFontSize
    };
  } catch {
    return { ...DEFAULT_FONT_PREFERENCES };
  }
}

export function saveAndApplyFontPreferences(prefs: FontPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures
  }
  const root = document.documentElement;
  root.style.setProperty('--font-ui', prefs.uiFont);
  root.style.setProperty('--font-ui-size', `${prefs.uiFontSize}px`);
  root.style.setProperty('--font-mono', prefs.editorFont);
  root.style.setProperty('--font-editor-size', `${prefs.editorFontSize}px`);
}
