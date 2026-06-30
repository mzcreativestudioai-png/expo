/**
 * Copyright © 2026 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/** The settled value a read returns, or the in-flight promise the caller suspends on. */
type SuspenseEntry = { data: unknown } | Promise<unknown>;

/**
 * Per-mount Suspense store for loader reads — the equivalent of urql's `_react` cache
 * (`react-urql`'s `getCacheForClient`). Holding the settled value (or in-flight promise) per resolved
 * URL is what lets a re-render read it instead of re-fetching. An entry is reclaimed once the last
 * mounted reader releases its key, keeping it short-lived and per-mount — distinct from the
 * persistent, shared document cache (`LoaderCache`, urql's `cacheExchange`).
 */
export class LoaderSuspenseStore {
  private entries = new Map<string, SuspenseEntry>();
  private refCounts = new Map<string, number>();
  private reclaimable = new Set<string>();

  get<T = unknown>(key: string): { data: T } | Promise<T> | undefined {
    return this.entries.get(key) as { data: T } | Promise<T> | undefined;
  }

  set(key: string, entry: SuspenseEntry) {
    this.reclaimable.delete(key);
    this.entries.set(key, entry);
  }

  clear(key: string) {
    this.reclaimable.delete(key);
    this.entries.delete(key);
  }

  retain(key: string) {
    this.refCounts.set(key, (this.refCounts.get(key) ?? 0) + 1);
    this.reclaimable.delete(key);
  }

  release(key: string) {
    const next = (this.refCounts.get(key) ?? 1) - 1;
    if (next > 0) {
      this.refCounts.set(key, next);
      return;
    }

    this.refCounts.delete(key);
    this.reclaimable.add(key);
    // Defer so an unmount→remount (Strict Mode, fast navigation) doesn't drop a live entry.
    queueMicrotask(() => {
      if (this.reclaimable.delete(key)) {
        this.entries.delete(key);
      }
    });
  }

  reset() {
    this.entries.clear();
    this.refCounts.clear();
    this.reclaimable.clear();
  }
}
