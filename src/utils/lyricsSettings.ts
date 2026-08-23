export interface LyricStyleSettings {
  font: string; // 'system' | 'sans' | 'serif' | 'mono' | 'display' | 'rounded'
  size: number; // in px, e.g. 48
  weight: string; // '100' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
  letterSpacing: number; // in px, e.g. -1, 0, 1, 2
  lineSpacing: number; // line-height multiplier, e.g. 1.2
  textCase: 'original' | 'lowercase' | 'uppercase' | 'titlecase';
  opacity?: number; // 0.1 to 1.0 (for unhighlighted)
}

export interface LyricsAppearanceSettings {
  highlighted: LyricStyleSettings;
  unhighlighted: LyricStyleSettings;
  alignment: 'left' | 'center' | 'right';
}

export const DEFAULT_LYRICS_SETTINGS: LyricsAppearanceSettings = {
  highlighted: {
    font: 'system',
    size: 48,
    weight: '800',
    letterSpacing: -1,
    lineSpacing: 1.2,
    textCase: 'original'
  },
  unhighlighted: {
    font: 'system',
    size: 20,
    weight: '500',
    opacity: 0.45,
    letterSpacing: 0,
    lineSpacing: 1.4,
    textCase: 'original'
  },
  alignment: 'center'
};

const STORAGE_KEY = 'yimly_lyrics_appearance_settings_v1';

export function getLyricsSettings(): LyricsAppearanceSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        highlighted: { ...DEFAULT_LYRICS_SETTINGS.highlighted, ...(parsed.highlighted || {}) },
        unhighlighted: { ...DEFAULT_LYRICS_SETTINGS.unhighlighted, ...(parsed.unhighlighted || {}) },
        alignment: parsed.alignment || DEFAULT_LYRICS_SETTINGS.alignment
      };
    }
  } catch (e) {
    console.error('Failed to load lyrics settings:', e);
  }
  return DEFAULT_LYRICS_SETTINGS;
}

export function saveLyricsSettings(settings: LyricsAppearanceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('yimly_lyrics_settings_changed', { detail: settings }));
  } catch (e) {
    console.error('Failed to save lyrics settings:', e);
  }
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

export function getFontFamilyClass(fontKey: string): string {
  switch (fontKey) {
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
