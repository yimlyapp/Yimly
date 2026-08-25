export interface LyricStyleSettings {
  font: string;
  size: number;
  weight: string;
  letterSpacing: number;
  lineSpacing: number;
  textCase: 'original' | 'lowercase' | 'uppercase' | 'titlecase';
  opacity?: number;
  color?: string;
}

export interface LyricsAppearanceSettings {
  highlighted: LyricStyleSettings;
  unhighlighted: LyricStyleSettings;
  alignment: 'left' | 'center' | 'right';
  visibleLines: number;
  highlightCurrentLine: boolean;
  animationDuration: number;
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
    animationDuration: typeof parsed.animationDuration === 'number' && !isNaN(parsed.animationDuration) ? parsed.animationDuration : DEFAULT_LYRICS_SETTINGS.animationDuration
  };
}
