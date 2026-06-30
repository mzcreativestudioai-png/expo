/**
 * Copyright © 2026 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { LoaderCache } from './LoaderCache';

type LoaderFetcher<T> = (path: string) => Promise<T>;

/**
 * Cache-first read for `useLoaderData`, modeled on urql's opt-in Suspense mode.
 *
 * Reads the per-mount Suspense store (`loaderCache.suspense`) first, so a re-render returns the
 * settled value or the in-flight promise rather than starting another fetch — the reason
 * render-driven loading can't loop. The caller suspends by passing a returned promise to `use()`.
 * Phase 1 is cache-first only; freshness is layered on in Phase 2.
 */
export function readLoaderData<T>(
  cache: LoaderCache,
  resolvedPath: string,
  fetcher: LoaderFetcher<T>
): T | Promise<T> {
  const suspended = cache.suspense.get<T>(resolvedPath);
  if (suspended instanceof Promise) {
    return suspended;
  }
  if (suspended) {
    return suspended.data;
  }

  const cachedError = cache.getError(resolvedPath);
  if (cachedError) {
    throw cachedError;
  }

  if (cache.hasData(resolvedPath)) {
    const data = cache.getData<T>(resolvedPath) as T;
    cache.suspense.set(resolvedPath, { data });
    return data;
  }

  const promise = fetchIntoDocument(cache, resolvedPath, fetcher).then(
    (data) => {
      cache.suspense.set(resolvedPath, { data });
      return data;
    },
    (error) => {
      // The error lives in the document layer; dropping the store entry lets a re-read re-throw it.
      cache.suspense.clear(resolvedPath);
      throw error;
    }
  );
  cache.suspense.set(resolvedPath, promise);
  return promise;
}

/** Fetch into the document cache, deduped via its promise map. */
function fetchIntoDocument<T>(
  cache: LoaderCache,
  path: string,
  fetcher: LoaderFetcher<T>
): Promise<T> {
  const inFlight = cache.getPromise<T>(path);
  if (inFlight) {
    return inFlight;
  }

  const promise = fetcher(path)
    .then((data) => {
      cache.setData(path, data);
      cache.deleteError(path);
      cache.deletePromise(path);
      return data;
    })
    .catch((error) => {
      const wrappedError = new Error(`Failed to load loader data for route: ${path}`, {
        cause: error,
      });
      cache.setError(path, wrappedError);
      cache.deleteData(path);
      cache.deletePromise(path);
      throw wrappedError;
    });

  cache.setPromise(path, promise);
  return promise;
}
