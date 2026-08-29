/**
 * IndexedDB storage utility for custom lyric fonts binary data.
 */

const DB_NAME = 'YimlyCustomFontsDB';
const STORE_NAME = 'fonts';
const DB_VERSION = 1;

export function openCustomFontsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveCustomFontStorage(fontKey: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openCustomFontsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(buffer, fontKey);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getCustomFontStorage(fontKey: string): Promise<ArrayBuffer | null> {
  const db = await openCustomFontsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(fontKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function removeCustomFontStorage(fontKey: string): Promise<void> {
  const db = await openCustomFontsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(fontKey);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadAndRegisterCustomFont(fontKey: string, customFontName?: string | null): Promise<void> {
  if (!fontKey || fontKey !== 'custom' || !customFontName) return;
  try {
    const buffer = await getCustomFontStorage(customFontName);
    if (buffer) {
      const fontFace = new FontFace(customFontName, buffer);
      await fontFace.load();
      document.fonts.add(fontFace);
      console.log(`[FontLoader] Successfully loaded and registered custom font: ${customFontName}`);
    }
  } catch (err) {
    console.error(`[FontLoader] Failed to load custom font ${customFontName}:`, err);
  }
}
