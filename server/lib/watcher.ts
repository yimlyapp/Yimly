import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/index.js';
import { libraries } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  SUPPORTED_AUDIO_EXTS,
  importSingleAudioFile,
  importSingleLrcFile,
  removeSingleFile,
  scanLibrary
} from './scanner.js';

export interface WatcherEvent {
  libraryId: number;
  filePath: string;
  action: 'upsert' | 'delete';
}

class LibraryWatcherManager {
  private watchers = new Map<number, { path: string; watcher: fsSync.FSWatcher | null }>();
  private pendingDebounce = new Map<string, NodeJS.Timeout>();
  private queue: WatcherEvent[] = [];
  private activeProcessing = new Set<string>();
  private isProcessing = false;
  private concurrency = 2;
  private runningWorkers = 0;
  private isStarted = false;

  /**
   * Initializes and starts watchers for all libraries configured in the database.
   */
  public async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    try {
      const allLibs = await db.select().from(libraries);
      for (const lib of allLibs) {
        this.watchLibrary(lib.id, lib.path);
      }
      console.log(`[LibraryWatcher] Initialized watchers for ${allLibs.length} media libraries.`);
    } catch (err) {
      console.error('[LibraryWatcher] Failed to start library watchers on DB load:', err);
    }
  }

  /**
   * Attaches or updates a filesystem watcher for a specific library directory.
   */
  public watchLibrary(libraryId: number, libPath: string): void {
    this.unwatchLibrary(libraryId);

    if (!libPath || typeof libPath !== 'string') return;
    const resolvedPath = path.resolve(libPath);

    if (!fsSync.existsSync(resolvedPath)) {
      console.warn(`[LibraryWatcher] Directory does not exist, skipping watch: ${resolvedPath}`);
      this.watchers.set(libraryId, { path: resolvedPath, watcher: null });
      return;
    }

    try {
      const watcher = fsSync.watch(resolvedPath, { recursive: true }, (eventType, relativeFilename) => {
        this.handleFsEvent(libraryId, resolvedPath, relativeFilename);
      });

      watcher.on('error', (err) => {
        console.error(`[LibraryWatcher] Watcher error on library ${libraryId} (${resolvedPath}):`, err);
      });

      this.watchers.set(libraryId, { path: resolvedPath, watcher });
      console.log(`[LibraryWatcher] Actively monitoring library ${libraryId} at: ${resolvedPath}`);
    } catch (err) {
      console.error(`[LibraryWatcher] Could not start watcher for library ${libraryId} (${resolvedPath}):`, err);
      this.watchers.set(libraryId, { path: resolvedPath, watcher: null });
    }
  }

  /**
   * Stops and cleans up the watcher for a specific library.
   */
  public unwatchLibrary(libraryId: number): void {
    const entry = this.watchers.get(libraryId);
    if (entry) {
      if (entry.watcher) {
        try {
          entry.watcher.close();
        } catch (err) {
          console.warn(`[LibraryWatcher] Error closing watcher for library ${libraryId}:`, err);
        }
      }
      this.watchers.delete(libraryId);
      console.log(`[LibraryWatcher] Stopped monitoring library ${libraryId}`);
    }
  }

  /**
   * Gracefully shuts down all active watchers and clears pending timers.
   */
  public stopAll(): void {
    for (const [libId, entry] of this.watchers.entries()) {
      if (entry.watcher) {
        try {
          entry.watcher.close();
        } catch {}
      }
    }
    this.watchers.clear();

    for (const timer of this.pendingDebounce.values()) {
      clearTimeout(timer);
    }
    this.pendingDebounce.clear();
    this.queue = [];
    this.activeProcessing.clear();
    this.isStarted = false;
    console.log('[LibraryWatcher] All library watchers stopped.');
  }

  /**
   * Internal handler for raw filesystem events.
   * Debounces events per file path before dispatching to worker queue.
   */
  private handleFsEvent(libraryId: number, rootDir: string, relativeFilename: string | null | undefined): void {
    let fullPath: string;
    if (relativeFilename) {
      fullPath = path.resolve(rootDir, relativeFilename);
    } else {
      fullPath = rootDir;
    }

    const key = `${libraryId}:${fullPath}`;

    // Clear existing debounce timer for this specific path
    const existingTimer = this.pendingDebounce.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Debounce by 500ms to coalesce bursts of events
    const timer = setTimeout(() => {
      this.pendingDebounce.delete(key);
      this.dispatchDebouncedPath(libraryId, fullPath);
    }, 500);

    this.pendingDebounce.set(key, timer);
  }

  /**
   * Evaluates the path after debounce, determines whether it is an audio file, lyrics, or directory,
   * checks existence/stability, and enqueues appropriate worker jobs.
   */
  private async dispatchDebouncedPath(libraryId: number, targetPath: string): Promise<void> {
    try {
      const exists = fsSync.existsSync(targetPath);

      if (!exists) {
        // File or directory was deleted/moved
        this.enqueue({ libraryId, filePath: targetPath, action: 'delete' });
        return;
      }

      const stats = await fs.stat(targetPath);
      if (stats.isDirectory()) {
        // Newly added or modified directory: scan and enqueue supported files within it
        await this.enqueueDirectory(libraryId, targetPath);
        return;
      }

      if (this.isSupportedFile(targetPath)) {
        this.enqueue({ libraryId, filePath: targetPath, action: 'upsert' });
      }
    } catch (err) {
      console.warn(`[LibraryWatcher] Error evaluating path ${targetPath}:`, err);
    }
  }

  /**
   * Recursively discovers and enqueues all supported files in a directory.
   */
  private async enqueueDirectory(libraryId: number, dirPath: string): Promise<void> {
    try {
      if (!fsSync.existsSync(dirPath)) return;
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const itemPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await this.enqueueDirectory(libraryId, itemPath);
        } else if (entry.isFile() && this.isSupportedFile(itemPath)) {
          this.enqueue({ libraryId, filePath: itemPath, action: 'upsert' });
        }
      }
    } catch (err) {
      console.warn(`[LibraryWatcher] Error reading directory ${dirPath}:`, err);
    }
  }

  private isSupportedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const lower = filePath.toLowerCase();
    return SUPPORTED_AUDIO_EXTS.has(ext) || lower.endsWith('.elrc.lrc') || ext === '.lrc';
  }

  /**
   * Adds an event to the processing queue with deduplication and triggers workers.
   */
  private enqueue(event: WatcherEvent): void {
    const dedupKey = `${event.libraryId}:${event.action}:${event.filePath}`;
    const alreadyQueued = this.queue.some(
      (item) => `${item.libraryId}:${item.action}:${item.filePath}` === dedupKey
    );

    if (!alreadyQueued && !this.activeProcessing.has(dedupKey)) {
      this.queue.push(event);
      this.triggerWorkers();
    }
  }

  private triggerWorkers(): void {
    while (this.runningWorkers < this.concurrency && this.queue.length > 0) {
      const nextJob = this.queue.shift();
      if (nextJob) {
        this.runningWorkers++;
        this.processJob(nextJob)
          .catch((err) => console.error(`[LibraryWatcher] Worker job failed:`, err))
          .finally(() => {
            this.runningWorkers--;
            this.triggerWorkers();
          });
      }
    }
  }

  /**
   * Verifies file stability (ensuring file copy has completed) and processes the job.
   */
  private async processJob(job: WatcherEvent): Promise<void> {
    const dedupKey = `${job.libraryId}:${job.action}:${job.filePath}`;
    this.activeProcessing.add(dedupKey);

    try {
      if (job.action === 'delete') {
        console.log(`[LibraryWatcher] Handling deletion of ${job.filePath}`);
        await removeSingleFile(job.libraryId, job.filePath);
        return;
      }

      // If action is upsert, ensure the file is stable before importing
      if (fsSync.existsSync(job.filePath)) {
        const isStable = await this.waitForFileStability(job.filePath);
        if (!isStable) {
          console.warn(`[LibraryWatcher] File did not stabilize or was removed during copy: ${job.filePath}`);
          return;
        }

        const ext = path.extname(job.filePath).toLowerCase();
        const lower = job.filePath.toLowerCase();

        if (SUPPORTED_AUDIO_EXTS.has(ext)) {
          console.log(`[LibraryWatcher] Importing audio file: ${job.filePath}`);
          await importSingleAudioFile(job.libraryId, job.filePath);
        } else if (lower.endsWith('.elrc.lrc') || ext === '.lrc') {
          console.log(`[LibraryWatcher] Importing lyrics file: ${job.filePath}`);
          await importSingleLrcFile(job.libraryId, job.filePath);
        }
      }
    } catch (err) {
      console.error(`[LibraryWatcher] Error processing ${job.filePath}:`, err);
    } finally {
      this.activeProcessing.delete(dedupKey);
    }
  }

  /**
   * Checks whether a file is finished copying by verifying size & mtime over consecutive samples.
   */
  public async waitForFileStability(
    filePath: string,
    maxWaitMs: number = 30000,
    pollIntervalMs: number = 500
  ): Promise<boolean> {
    const startTime = Date.now();
    let lastSize = -1;
    let lastMtime = -1;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        if (!fsSync.existsSync(filePath)) {
          return false;
        }

        const stats = await fs.stat(filePath);
        const currentSize = stats.size;
        const currentMtime = stats.mtimeMs;

        // If file size is greater than 0 and size & mtime haven't changed since last sample, it's stable
        if (lastSize !== -1 && currentSize === lastSize && currentMtime === lastMtime && currentSize > 0) {
          return true;
        }

        lastSize = currentSize;
        lastMtime = currentMtime;
      } catch {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // If timeout reached but file exists and size > 0, proceed
    try {
      if (fsSync.existsSync(filePath)) {
        const stats = await fs.stat(filePath);
        return stats.size > 0;
      }
    } catch {}

    return false;
  }

  /**
   * Diagnostic method to inspect watcher status.
   */
  public getStatus() {
    const monitored: Array<{ libraryId: number; path: string; active: boolean }> = [];
    for (const [libId, entry] of this.watchers.entries()) {
      monitored.push({
        libraryId: libId,
        path: entry.path,
        active: entry.watcher !== null,
      });
    }
    return {
      isStarted: this.isStarted,
      monitoredCount: monitored.length,
      queueLength: this.queue.length,
      activeProcessing: Array.from(this.activeProcessing),
      libraries: monitored,
    };
  }
}

export const libraryWatcher = new LibraryWatcherManager();
