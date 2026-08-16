/**
 * useLocalSearch — instant on-device search over the discussions the user
 * has seen, powered by the TF-IDF keyword index (localIndex.ts).
 *
 * The host page feeds items via `indexItems` (debounced internally);
 * a debounced search runs whenever the query changes. No network involved.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  countDocs,
  listSouls,
  removeDoc,
  searchIndex,
  upsertDoc,
  type SearchHit,
} from "../lib/localIndex";
import { debounce } from "../lib/util";

interface IndexableItem {
  id: string;
  title: string;
  body?: string;
  category?: string;
  author?: string;
}

interface IndexableList {
  length: number;
  forEach(cb: (item: IndexableItem) => void): void;
}

const SEARCH_DEBOUNCE_MS = 250;
const INDEX_DEBOUNCE_MS = 800;
const DEFAULT_LIMIT = 10;

function toSoul(item: IndexableItem): string {
  return `item_${item.id}`;
}

export function useLocalSearch(limit = DEFAULT_LIMIT) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexed, setIndexed] = useState(0);

  // Debounced indexer — feed it the full item list whenever it changes.
  const indexerRef = useRef(
    debounce((items: IndexableList) => {
      void (async () => {
        try {
          const jobs: Promise<void>[] = [];
          const current = new Set<string>();
          items.forEach((item) => {
            if (!item || !item.id || !item.title) return;
            current.add(toSoul(item));
            jobs.push(
              upsertDoc(
                toSoul(item),
                item.title,
                `${item.body ?? ""} ${item.category ?? ""} ${item.author ?? ""}`,
              ),
            );
          });
          // Await every upsert before recounting — otherwise countDocs()
          // races ahead of the writes and reports a stale (lower) number.
          await Promise.all(jobs);
          // Sweep: drop indexed docs that no longer exist in the feed
          // (deleted posts/discussions must not stay searchable).
          const stored = await listSouls();
          const sweep: Promise<void>[] = [];
          for (const soul of stored) {
            if (!current.has(soul)) sweep.push(removeDoc(soul));
          }
          await Promise.all(sweep);
          setIndexed(await countDocs());
        } catch {
          /* IndexedDB unavailable — search degrades to empty results */
        }
      })();
    }, INDEX_DEBOUNCE_MS),
  );

  const indexItems = useCallback((items: IndexableList) => {
    if (!items || items.length === 0) return;
    indexerRef.current(items);
  }, []);

  // Debounced search on query change.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const hits = await searchIndex(q, limit);
          if (!cancelled) setResults(hits);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, limit]);

  return { query, setQuery, results, searching, indexed, indexItems };
}