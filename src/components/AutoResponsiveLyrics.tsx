import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LyricsAppearanceSettings } from '../utils/lyricsSettings';

export interface LyricLine {
  time: number;
  text: string;
}

interface AutoResponsiveLyricsProps {
  lyrics: LyricLine[];
  focusIndex: number;
  lyricsSettings: LyricsAppearanceSettings;
  isHighlighted: boolean;
  animDuration?: number;
  prev2Line?: LyricLine | null;
  prev1Line?: LyricLine | null;
  currLine?: LyricLine | null;
  next1Line?: LyricLine | null;
  next2Line?: LyricLine | null;
  visibleLinesCount?: number;
  applyTextCase: (text: string, textCase?: string) => string;
  getFontFamilyStyle: (fontId?: string) => string;
  getAlignmentClass: (alignment?: string) => string;
  // Optional preview mode flag for Settings screen
  isPreview?: boolean;
}

export const AutoResponsiveLyrics: React.FC<AutoResponsiveLyricsProps> = ({
  lyrics,
  focusIndex,
  lyricsSettings,
  isHighlighted,
  animDuration = 0.25,
  prev2Line = null,
  prev1Line = null,
  currLine = null,
  next1Line = null,
  next2Line = null,
  visibleLinesCount = 3,
  applyTextCase,
  getFontFamilyStyle,
  getAlignmentClass,
  isPreview = false,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState<number>(1);
  const [effectiveGap, setEffectiveGap] = useState<number>(12);

  // Auto-Optimization Measurement Algorithm
  const recalculateLayout = () => {
    if (!stageRef.current || !groupRef.current) return;

    const stageEl = stageRef.current;
    const groupEl = groupRef.current;

    const stageWidth = stageEl.clientWidth;
    const stageHeight = stageEl.clientHeight;

    if (stageWidth <= 0 || stageHeight <= 0) return;

    // Determine safe vertical and horizontal paddings
    // Account for safe area insets & TV display borders
    const paddingY = isPreview
      ? 12
      : Math.max(16, Math.round(stageHeight * 0.04));
    const paddingX = isPreview
      ? 16
      : Math.max(20, Math.round(stageWidth * 0.04));

    const safeHeight = Math.max(100, stageHeight - paddingY * 2);
    const safeWidth = Math.max(200, stageWidth - paddingX * 2);

    // Unscaled natural dimensions of the lyrics group
    const baseGap = Math.max(
      6,
      Math.round((lyricsSettings.unhighlighted.size || 24) * 0.3)
    );

    const groupHeight = groupEl.scrollHeight || groupEl.offsetHeight;
    const groupWidth = groupEl.scrollWidth || groupEl.offsetWidth;

    if (groupHeight <= 0 || groupWidth <= 0) return;

    // Step 1: Dynamically adjust vertical line gap if height exceeds safe area
    let computedGap = baseGap;
    let projectedHeight = groupHeight;

    if (projectedHeight > safeHeight && computedGap > 4) {
      const extraHeight = projectedHeight - safeHeight;
      const numGaps = Math.max(1, (visibleLinesCount || 3) - 1);
      const gapReduction = Math.min(
        computedGap - 4,
        Math.ceil(extraHeight / numGaps)
      );
      computedGap = Math.max(4, computedGap - gapReduction);
      projectedHeight -= gapReduction * numGaps;
    }

    // Step 2: Proportional scaling if height or width still exceeds safe bounds
    let computedScale = 1;
    const scaleY = safeHeight / projectedHeight;
    const scaleX = safeWidth / groupWidth;

    if (scaleY < 1 || scaleX < 1) {
      computedScale = Math.min(scaleY, scaleX);
      // Floor to 2 decimal places to prevent sub-pixel animation jitter
      computedScale = Math.max(0.3, Math.floor(computedScale * 100) / 100);
    }

    setEffectiveGap(computedGap);
    setScale(computedScale);
  };

  useLayoutEffect(() => {
    recalculateLayout();
  }, [
    lyrics,
    focusIndex,
    lyricsSettings,
    visibleLinesCount,
    currLine?.text,
    prev1Line?.text,
    next1Line?.text,
    prev2Line?.text,
    next2Line?.text,
    isHighlighted,
    isPreview,
  ]);

  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;

    const observer = new ResizeObserver(() => {
      recalculateLayout();
    });

    observer.observe(stageEl);

    const handleGlobalResize = () => {
      recalculateLayout();
    };

    window.addEventListener('resize', handleGlobalResize);
    window.addEventListener('orientationchange', handleGlobalResize);
    document.addEventListener('fullscreenchange', handleGlobalResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleGlobalResize);
      window.removeEventListener('orientationchange', handleGlobalResize);
      document.removeEventListener('fullscreenchange', handleGlobalResize);
    };
  }, [lyricsSettings, visibleLinesCount]);

  const alignment = lyricsSettings.alignment || 'center';
  const flexJustifyClass =
    alignment === 'left'
      ? 'justify-start text-left'
      : alignment === 'right'
      ? 'justify-end text-right'
      : 'justify-center text-center';

  return (
    <div
      ref={stageRef}
      className="w-full flex-1 h-full min-h-0 flex flex-col justify-center items-center overflow-hidden relative select-none"
    >
      <div
        ref={groupRef}
        className={`w-full max-w-5xl mx-auto flex flex-col justify-center items-center overflow-visible transition-all duration-200 ease-out ${getAlignmentClass(
          alignment
        )}`}
        style={{
          gap: `${effectiveGap}px`,
          transform: scale < 1 ? `scale(${scale})` : 'none',
          transformOrigin: 'center center',
          width: '100%',
        }}
      >
        {/* Line -2 (if 5 lines mode) */}
        {visibleLinesCount === 5 && (
          <div className={`flex items-center shrink-0 w-full overflow-visible py-0.5 ${flexJustifyClass}`}>
            <AnimatePresence mode="wait">
              {prev2Line ? (
                <motion.p
                  key={`prev2-${prev2Line.time}-${prev2Line.text}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{
                    opacity: (lyricsSettings.unhighlighted.opacity ?? 0.45) * 0.6,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                    fontSize: `${Math.max(12, lyricsSettings.unhighlighted.size - 2)}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: alignment,
                  }}
                  className="w-full whitespace-normal break-words leading-tight"
                >
                  {applyTextCase(prev2Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-4 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Line -1: Previous Lyric */}
        {visibleLinesCount >= 3 && (
          <div className={`flex items-center shrink-0 w-full overflow-visible py-1 ${flexJustifyClass}`}>
            <AnimatePresence mode="wait">
              {prev1Line ? (
                <motion.p
                  key={`prev1-${prev1Line.time}-${prev1Line.text}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{
                    opacity: lyricsSettings.unhighlighted.opacity ?? 0.45,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                    fontSize: `${lyricsSettings.unhighlighted.size}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: alignment,
                  }}
                  className="w-full whitespace-normal break-words leading-tight"
                >
                  {applyTextCase(prev1Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-5 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Line 0: Current Lyric (Visually dominant and centered) */}
        <div className={`flex items-center shrink-0 w-full overflow-visible py-1.5 px-2 ${flexJustifyClass}`}>
          <AnimatePresence mode="wait">
            {currLine ? (
              <motion.p
                key={`curr-${currLine.time}-${currLine.text}-${isHighlighted}`}
                initial={{ opacity: 0, scale: isHighlighted ? 0.98 : 1, y: 0 }}
                animate={{
                  opacity: isHighlighted
                    ? lyricsSettings.highlighted.opacity ?? 1.0
                    : lyricsSettings.unhighlighted.opacity ?? 0.45,
                  scale: 1,
                  y: 0,
                }}
                exit={{ opacity: 0, scale: isHighlighted ? 1.02 : 1, y: 0 }}
                transition={{ duration: animDuration, ease: 'easeOut' }}
                style={{
                  fontFamily: isHighlighted
                    ? getFontFamilyStyle(lyricsSettings.highlighted.font)
                    : getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                  fontSize: `${
                    isHighlighted
                      ? lyricsSettings.highlighted.size
                      : lyricsSettings.unhighlighted.size
                  }px`,
                  fontWeight: isHighlighted
                    ? lyricsSettings.highlighted.weight
                    : lyricsSettings.unhighlighted.weight,
                  color: isHighlighted
                    ? lyricsSettings.highlighted.color || '#FF4FA3'
                    : lyricsSettings.unhighlighted.color || '#d4d4d8',
                  letterSpacing: `${
                    isHighlighted
                      ? lyricsSettings.highlighted.letterSpacing
                      : lyricsSettings.unhighlighted.letterSpacing
                  }px`,
                  lineHeight: isHighlighted
                    ? lyricsSettings.highlighted.lineSpacing
                    : lyricsSettings.unhighlighted.lineSpacing,
                  textAlign: alignment,
                  textShadow: isHighlighted
                    ? `0 0 35px ${
                        lyricsSettings.highlighted.color || '#FF4FA3'
                      }75`
                    : 'none',
                }}
                className="w-full whitespace-normal break-words leading-tight"
              >
                {applyTextCase(
                  currLine.text || '♪ ♪ ♪',
                  isHighlighted
                    ? lyricsSettings.highlighted.textCase
                    : lyricsSettings.unhighlighted.textCase
                )}
              </motion.p>
            ) : (
              <p className="text-zinc-600 text-xl md:text-3xl font-bold w-full text-center">
                ♪ ♪ ♪
              </p>
            )}
          </AnimatePresence>
        </div>

        {/* Line +1: Next Lyric */}
        {visibleLinesCount >= 3 && (
          <div className={`flex items-center shrink-0 w-full overflow-visible py-1 ${flexJustifyClass}`}>
            <AnimatePresence mode="wait">
              {next1Line ? (
                <motion.p
                  key={`next1-${next1Line.time}-${next1Line.text}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{
                    opacity: lyricsSettings.unhighlighted.opacity ?? 0.45,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                    fontSize: `${lyricsSettings.unhighlighted.size}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: alignment,
                  }}
                  className="w-full whitespace-normal break-words leading-tight"
                >
                  {applyTextCase(next1Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-5 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Line +2 (if 5 lines mode) */}
        {visibleLinesCount === 5 && (
          <div className={`flex items-center shrink-0 w-full overflow-visible py-0.5 ${flexJustifyClass}`}>
            <AnimatePresence mode="wait">
              {next2Line ? (
                <motion.p
                  key={`next2-${next2Line.time}-${next2Line.text}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{
                    opacity: (lyricsSettings.unhighlighted.opacity ?? 0.45) * 0.6,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                    fontSize: `${Math.max(12, lyricsSettings.unhighlighted.size - 2)}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: alignment,
                  }}
                  className="w-full whitespace-normal break-words leading-tight"
                >
                  {applyTextCase(next2Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-4 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
