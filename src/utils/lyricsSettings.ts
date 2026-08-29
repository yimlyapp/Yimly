import { loadAndRegisterCustomFont } from './customFontStorage';

export interface LyricStyleSettings {
  font: string; // 'system' | 'sans' | 'serif' | 'mono' | 'display' | 'rounded'
  size: number; // in px, e.g. 48
  weight: string; // '100' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
  letterSpacing: number; // in px, e.g. -1, 0, 1, 2
  lineSpacing: number; // line-height multiplier, e.g. 1.2
  textCase: 'original' | 'lowercase' | 'uppercase' | 'titlecase';
  opacity?: number; // 0.1 to 1.0 (for unhighlighted / highlighted)
  color?: string; // hex color string, e.g. '#FF4FA3'
}

export interface LyricsAppearanceSettings {
  highlighted: LyricStyleSettings;
  unhighlighted: LyricStyleSettings;
  alignment: 'left' | 'center' | 'right';
  visibleLines: number; // 1 | 3 | 5
  highlightCurrentLine: boolean; // on / off
  animationDuration: number; // in seconds, e.g. 0.25
  elrcHighlightMode?: 'karaoke' | 'current_only'; // 'karaoke' (past + current) or 'current_only'
  customFontName?: string | null;
  customFontFileName?: string | null;
}

export const DEFAULT_LYRICS_SETTINGS: LyricsAppearanceSettings = {
  highlighted: {
    font: 'system',
    size: 48,
    weight: '800',
    letterSpacing: -1,
    lineSpacing: 1.2,
    textCase: 'original',
    opacity: 1.0,
    color: '#FF4FA3'
  },
  unhighlighted: {
    font: 'system',
    size: 20,
    weight: '500',
    opacity: 0.45,
    letterSpacing: 0,
    lineSpacing: 1.4,
    textCase: 'original',
    color: '#d4d4d8'
  },
  alignment: 'center',
  visibleLines: 3,
  highlightCurrentLine: true,
  animationDuration: 0.25,
  elrcHighlightMode: 'karaoke'
};

const STORAGE_KEY = 'yimly_lyrics_appearance_settings_v1';

/**
 * Deeply validates, sanitizes, and completes any partial or raw settings object
 * into the canonical full LyricsAppearanceSettings structure.
 */
export function resolveLyricsSettings(raw?: any): LyricsAppearanceSettings {
  const parsed = (raw && typeof raw === 'object') ? raw : {};
  const high = (parsed.highlighted && typeof parsed.highlighted === 'object') ? parsed.highlighted : {};
  const unhigh = (parsed.unhighlighted && typeof parsed.unhighlighted === 'object') ? parsed.unhighlighted : {};

  const validTextCases = ['original', 'lowercase', 'uppercase', 'titlecase'] as const;
  const validAlignments = ['left', 'center', 'right'] as const;

  return {
    highlighted: {
      font: typeof high.font === 'string' && high.font.trim() ? high.font.trim() : DEFAULT_LYRICS_SETTINGS.highlighted.font,
      size: typeof high.size === 'number' && !isNaN(high.size) ? high.size : DEFAULT_LYRICS_SETTINGS.highlighted.size,
      weight: high.weight ? String(high.weight) : DEFAULT_LYRICS_SETTINGS.highlighted.weight,
      letterSpacing: typeof high.letterSpacing === 'number' && !isNaN(high.letterSpacing) ? high.letterSpacing : DEFAULT_LYRICS_SETTINGS.highlighted.letterSpacing,
      lineSpacing: typeof high.lineSpacing === 'number' && !isNaN(high.lineSpacing) ? high.lineSpacing : DEFAULT_LYRICS_SETTINGS.highlighted.lineSpacing,
      textCase: validTextCases.includes(high.textCase) ? high.textCase : DEFAULT_LYRICS_SETTINGS.highlighted.textCase,
      opacity: typeof high.opacity === 'number' && !isNaN(high.opacity) ? high.opacity : DEFAULT_LYRICS_SETTINGS.highlighted.opacity,
      color: typeof high.color === 'string' && high.color.trim() ? high.color.trim() : DEFAULT_LYRICS_SETTINGS.highlighted.color
    },
    unhighlighted: {
      font: typeof unhigh.font === 'string' && unhigh.font.trim() ? unhigh.font.trim() : DEFAULT_LYRICS_SETTINGS.unhighlighted.font,
      size: typeof unhigh.size === 'number' && !isNaN(unhigh.size) ? unhigh.size : DEFAULT_LYRICS_SETTINGS.unhighlighted.size,
      weight: unhigh.weight ? String(unhigh.weight) : DEFAULT_LYRICS_SETTINGS.unhighlighted.weight,
      letterSpacing: typeof unhigh.letterSpacing === 'number' && !isNaN(unhigh.letterSpacing) ? unhigh.letterSpacing : DEFAULT_LYRICS_SETTINGS.unhighlighted.letterSpacing,
      lineSpacing: typeof unhigh.lineSpacing === 'number' && !isNaN(unhigh.lineSpacing) ? unhigh.lineSpacing : DEFAULT_LYRICS_SETTINGS.unhighlighted.lineSpacing,
      textCase: validTextCases.includes(unhigh.textCase) ? unhigh.textCase : DEFAULT_LYRICS_SETTINGS.unhighlighted.textCase,
      opacity: typeof unhigh.opacity === 'number' && !isNaN(unhigh.opacity) ? unhigh.opacity : DEFAULT_LYRICS_SETTINGS.unhighlighted.opacity,
      color: typeof unhigh.color === 'string' && unhigh.color.trim() ? unhigh.color.trim() : DEFAULT_LYRICS_SETTINGS.unhighlighted.color
    },
    alignment: validAlignments.includes(parsed.alignment) ? parsed.alignment : DEFAULT_LYRICS_SETTINGS.alignment,
    visibleLines: [1, 3, 5].includes(parsed.visibleLines) ? parsed.visibleLines : DEFAULT_LYRICS_SETTINGS.visibleLines,
    highlightCurrentLine: typeof parsed.highlightCurrentLine === 'boolean' ? parsed.highlightCurrentLine : DEFAULT_LYRICS_SETTINGS.highlightCurrentLine,
    animationDuration: typeof parsed.animationDuration === 'number' && !isNaN(parsed.animationDuration) ? parsed.animationDuration : DEFAULT_LYRICS_SETTINGS.animationDuration,
    elrcHighlightMode: ['karaoke', 'current_only'].includes(parsed.elrcHighlightMode) ? parsed.elrcHighlightMode : DEFAULT_LYRICS_SETTINGS.elrcHighlightMode,
    customFontName: typeof parsed.customFontName === 'string' && parsed.customFontName.trim() ? parsed.customFontName.trim() : null,
    customFontFileName: typeof parsed.customFontFileName === 'string' && parsed.customFontFileName.trim() ? parsed.customFontFileName.trim() : null
  };
}

/**
 * Loads the canonical lyric appearance settings from persistent storage.
 * Always resolves to a complete, valid LyricsAppearanceSettings object.
 */
export function getLyricsSettings(): LyricsAppearanceSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const canonical = resolveLyricsSettings(parsed);
      loadAndRegisterCustomFont(canonical.highlighted.font, canonical.customFontName);
      loadAndRegisterCustomFont(canonical.unhighlighted.font, canonical.customFontName);
      console.log('[LyricsSettings] Successfully loaded persisted settings from localStorage:', canonical);
      return canonical;
    }
  } catch (e) {
    console.error('[LyricsSettings] Failed to load lyrics settings from localStorage, falling back to defaults:', e);
  }
  console.log('[LyricsSettings] No persisted settings found; using canonical defaults.');
  return DEFAULT_LYRICS_SETTINGS;
}

/**
 * Saves canonical lyric appearance settings to persistent storage and notifies
 * any active rooms or listeners immediately.
 */
export function saveLyricsSettings(settings: LyricsAppearanceSettings, sessionId?: string): void {
  try {
    const canonical = resolveLyricsSettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(canonical));
    window.dispatchEvent(new CustomEvent('yimly_lyrics_settings_changed', { detail: canonical }));
    console.log('[LyricsSettings] Persisted updated lyric appearance settings locally:', canonical);

    // Persist to server default settings
    fetch('/api/karaoke/settings/lyrics', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: canonical }),
    }).catch(err => console.warn('[LyricsSettings] Failed to save settings to server default:', err));

    // If active session ID is provided, also sync directly to the session
    if (sessionId) {
      fetch(`/api/karaoke/sessions/${sessionId}/lyrics-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: canonical }),
      }).catch(err => console.warn(`[LyricsSettings] Failed to sync settings to session ${sessionId}:`, err));
    }
  } catch (e) {
    console.error('[LyricsSettings] Failed to save lyrics settings:', e);
  }
}

/**
 * Fetches the canonical lyric appearance settings from the server.
 * Updates local storage cache upon success.
 */
export async function fetchServerLyricsSettings(sessionId?: string): Promise<LyricsAppearanceSettings> {
  try {
    const url = sessionId 
      ? `/api/karaoke/sessions/${sessionId}/lyrics-settings` 
      : '/api/karaoke/settings/lyrics';

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.settings) {
        const canonical = resolveLyricsSettings(data.settings);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(canonical));
        } catch (e) {
          // ignore localStorage error
        }
        return canonical;
      }
    }
  } catch (err) {
    console.warn('[LyricsSettings] Failed to fetch server lyrics settings:', err);
  }
  return getLyricsSettings();
}

export function applyTextCase(text: string, textCase: string): string {
  if (!text) return '';
  switch (textCase) {
    case 'lowercase':
      return text.toLowerCase();
    case 'uppercase':
      return text.toUpperCase();
    case 'titlecase':
      return text.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
    case 'original':
    default:
      return text;
  }
}

export interface LyricFontOption {
  value: string;
  label: string;
  fontFamily: string;
}

export const LYRICS_FONT_OPTIONS: LyricFontOption[] = [
  {
    value: 'system',
    label: 'Default / System',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  },
  {
    value: 'huggable',
    label: 'Huggable',
    fontFamily: '"Huggable", "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Quicksand", system-ui, sans-serif'
  },
  {
    value: 'super-sale',
    label: 'Super Sale',
    fontFamily: '"Super Sale", Impact, "Arial Black", "Trebuchet MS", system-ui, sans-serif'
  },
  {
    value: 'sans',
    label: 'Sans-Serif',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  {
    value: 'serif',
    label: 'Serif',
    fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
  },
  {
    value: 'mono',
    label: 'Monospace',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  },
  {
    value: 'display',
    label: 'Display / Impact',
    fontFamily: 'Impact, "Arial Black", "Trebuchet MS", sans-serif'
  },
  {
    value: 'rounded',
    label: 'Rounded',
    fontFamily: '"SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Quicksand", sans-serif'
  },
  {
    value: 'custom',
    label: 'Custom Font',
    fontFamily: 'custom'
  }
];

export function getFontFamilyStyle(fontKey: string, customFontName?: string | null): string {
  const normalized = (fontKey || '').toLowerCase().trim();
  if (normalized === 'custom' && customFontName) {
    return `"${customFontName}", sans-serif`;
  }
  if (normalized === 'huggable') {
    return '"Huggable", "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Quicksand", system-ui, sans-serif';
  }
  if (normalized === 'super sale' || normalized === 'super-sale' || normalized === 'supersale') {
    return '"Super Sale", Impact, "Arial Black", "Trebuchet MS", system-ui, sans-serif';
  }
  switch (normalized) {
    case 'sans':
      return 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    case 'serif':
      return 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
    case 'mono':
      return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    case 'display':
      return 'Impact, "Arial Black", "Trebuchet MS", sans-serif';
    case 'rounded':
      return '"SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Quicksand", sans-serif';
    case 'system':
    default:
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }
}

export function getFontFamilyClass(fontKey: string): string {
  const normalized = (fontKey || '').toLowerCase().trim();
  if (normalized === 'huggable') {
    return 'font-["Huggable",sans-serif]';
  }
  if (normalized === 'super sale' || normalized === 'super-sale' || normalized === 'supersale') {
    return 'font-["Super_Sale",sans-serif]';
  }
  switch (normalized) {
    case 'sans':
      return 'font-sans';
    case 'serif':
      return 'font-serif';
    case 'mono':
      return 'font-mono';
    case 'display':
      return 'font-[Impact,Arial_Black,sans-serif]';
    case 'rounded':
      return 'font-["SF_Pro_Rounded",system-ui,sans-serif]';
    case 'system':
    default:
      return 'font-sans';
  }
}

export function getAlignmentClass(alignment: 'left' | 'center' | 'right'): string {
  switch (alignment) {
    case 'left':
      return 'text-left items-start';
    case 'right':
      return 'text-right items-end';
    case 'center':
    default:
      return 'text-center items-center';
  }
}
