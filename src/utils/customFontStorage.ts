/**
 * Server-backed custom lyric font loader and cache utility.
 * Fonts are fetched from the Yimly server and registered in document.fonts using FontFace.
 */

const loadedFontFaces = new Map<string, Promise<void>>();

export function isCustomFontLoaded(customFontName: string): boolean {
  if (!customFontName || typeof document === 'undefined' || !document.fonts) return false;
  let loaded = false;
  document.fonts.forEach((face) => {
    if (face.family === customFontName && face.status === 'loaded') {
      loaded = true;
    }
  });
  return loaded;
}

export async function loadAndRegisterCustomFont(
  fontKey: string,
  customFontName?: string | null,
  customFontUrl?: string | null
): Promise<void> {
  if (!fontKey || fontKey !== 'custom' || !customFontName || typeof document === 'undefined' || !('fonts' in document)) {
    return;
  }

  const fontUrl = customFontUrl || '/api/karaoke/settings/lyrics/custom-font';
  const cacheKey = `${customFontName}::${fontUrl}`;

  if (loadedFontFaces.has(cacheKey)) {
    return loadedFontFaces.get(cacheKey);
  }

  if (isCustomFontLoaded(customFontName)) {
    loadedFontFaces.set(cacheKey, Promise.resolve());
    return;
  }

  const loadPromise = (async () => {
    try {
      const fontFace = new FontFace(customFontName, `url(${fontUrl})`);
      await fontFace.load();
      document.fonts.add(fontFace);
      console.log(`[FontLoader] Successfully loaded server-persisted custom font "${customFontName}" from ${fontUrl}`);
    } catch (err) {
      console.error(`[FontLoader] Failed to load custom font "${customFontName}" from server:`, err);
      // Remove failed promise so retry is possible
      loadedFontFaces.delete(cacheKey);
    }
  })();

  loadedFontFaces.set(cacheKey, loadPromise);
  return loadPromise;
}

export async function preloadCustomFont(customFontName: string, customFontUrl?: string | null): Promise<void> {
  return loadAndRegisterCustomFont('custom', customFontName, customFontUrl);
}
