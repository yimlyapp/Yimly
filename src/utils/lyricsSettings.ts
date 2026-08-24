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
  animationDuration: 0.25
};

const STORAGE_KEY = 'yimly_lyrics_appearance_settings_v1';

export function getLyricsSettings(): LyricsAppearanceSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        highlighted: { 
          ...DEFAULT_LYRICS_SETTINGS.highlighted, 
          ...(parsed.highlighted || {}) 
        },
        unhighlighted: { 
          ...DEFAULT_LYRICS_SETTINGS.unhighlighted, 
          ...(parsed.unhighlighted || {}) 
        },
        alignment: parsed.alignment || DEFAULT_LYRICS_SETTINGS.alignment,
        visibleLines: typeof parsed.visibleLines === 'number' ? parsed.visibleLines : DEFAULT_LYRICS_SETTINGS.visibleLines,
        highlightCurrentLine: typeof parsed.highlightCurrentLine === 'boolean' ? parsed.highlightCurrentLine : DEFAULT_LYRICS_SETTINGS.highlightCurrentLine,
        animationDuration: typeof parsed.animationDuration === 'number' ? parsed.animationDuration : DEFAULT_LYRICS_SETTINGS.animationDuration
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
  }
];

export function getFontFamilyStyle(fontKey: string): string {
  const normalized = (fontKey || '').toLowerCase().trim();
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
