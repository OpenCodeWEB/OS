/**
 * LocalIndex — on-device keyword vector index over the GunDB graph.
 *
 * Provides instant full-text search over content the user has already seen,
 * without any network round-trip and without an embedding model (deterministic
 * environment: no Ollama). Uses a TF-IDF weighted bag-of-words vector per
 * document, ranked by cosine similarity against the query vector.
 *
 * Storage (IndexedDB "opencodeweb-local-index"):
 *   docs  : soul → { soul, title, body, updatedAt, tokens: {term: tf} }
 *
 * Search loads the (small) doc corpus, derives document frequencies, and
 * scores. Corpus is bounded per-soul: indexing upserts, never grows unbounded.
 */
import { debounce } from "./util";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface IndexedDoc {
  soul: string;
  title: string;
  body: string;
  updatedAt: number;
  /** term → term frequency within this doc (tokenized title+body) */
  tokens: Record<string, number>;
}

export interface SearchHit {
  soul: string;
  score: number;
  snippet: string;
}

/* ------------------------------------------------------------------ */
/*  Tokenizer                                                          */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "to", "for", "on", "in",
  "with", "is", "are", "was", "were", "be", "been", "being", "it", "its",
  "this", "that", "these", "those", "i", "you", "we", "they", "he", "she",
  "them", "their", "there", "from", "at", "by", "as", "not", "no", "so", "do",
  "does", "did", "have", "has", "had", "will", "would", "can", "could",
  "should", "about", "into", "than", "then", "what", "when", "where", "which",
  "who", "whom", "your", "my", "me", "him", "her", "our", "us", "up", "out",
  "just", "all", "any", "some", "more", "most", "other", "such", "only",
  "own", "same", "too", "very", "also", "how", "why",
]);

/** Split text into lowercase alphanumeric tokens, dropping stopwords. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const raw = text.toLowerCase().split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const t of raw) {
    if (t.length > 1 && !STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

function countTokens(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tokens) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

/* ------------------------------------------------------------------ */
/*  IndexedDB plumbing                                                 */
/* ------------------------------------------------------------------ */

const DB_NAME = "opencodeweb-local-index";
const DOCS = "docs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) {
        db.createObjectStore(DOCS, { keyPath: "soul" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS, mode);
    const req = fn(tx.objectStore(DOCS));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ------------------------------------------------------------------ */
/*  Index API                                                          */
/* ------------------------------------------------------------------ */

/** Upsert a document into the local index. */
export async function upsertDoc(
  soul: string,
  title: string,
  body: string,
): Promise<void> {
  if (!soul) return;
  const tokens = countTokens(tokenize(`${title} ${body}`));
  const doc: IndexedDoc = {
    soul,
    title,
    body,
    updatedAt: Date.now(),
    tokens,
  };
  await withStore("readwrite", (s) => s.put(doc));
}

/** Remove a document (e.g. deleted post) from the local index. */
export async function removeDoc(soul: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(soul));
}

/** Number of indexed documents. */
export async function countDocs(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS, "readonly");
    const req = tx.objectStore(DOCS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** All currently indexed souls (for stale-document sweeps). */
export async function listSouls(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS, "readonly");
    const req = tx.objectStore(DOCS).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Ranked full-text search over indexed documents.
 * TF-IDF weighting, cosine similarity, snippet extraction.
 */
export async function searchIndex(
  query: string,
  limit = 10,
): Promise<SearchHit[]> {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const db = await openDb();
  const docs = await new Promise<IndexedDoc[]>((resolve, reject) => {
    const tx = db.transaction(DOCS, "readonly");
    const req = tx.objectStore(DOCS).getAll();
    req.onsuccess = () => resolve(req.result as IndexedDoc[]);
    req.onerror = () => reject(req.error);
  });
  if (docs.length === 0) return [];

  // Query vector (bag of words).
  const qVec = countTokens(qTokens);

  // Document frequencies: how many docs contain each query term.
  const df: Record<string, number> = {};
  for (const term of Object.keys(qVec)) {
    df[term] = 0;
    for (const doc of docs) if (doc.tokens[term]) df[term] += 1;
  }
  const N = docs.length;

  // Score each doc: cosine similarity over TF-IDF-weighted vectors.
  const scored: { doc: IndexedDoc; score: number }[] = [];
  for (const doc of docs) {
    const tfs = doc.tokens;
    if (Object.keys(tfs).length === 0) continue;
    let dot = 0;
    let docNorm = 0;
    let qNorm = 0;
    for (const [term, qtf] of Object.entries(qVec)) {
      const idf = Math.log(1 + N / (1 + (df[term] ?? 0)));
      const w = qtf * idf;
      qNorm += w * w;
      const tf = tfs[term] ?? 0;
      if (tf > 0) {
        const dw = (1 + Math.log(tf)) * idf;
        dot += w * dw;
        docNorm += dw * dw;
      }
    }
    // qNorm is constant across docs — but keep the full cosine for clarity.
    const score = docNorm > 0 ? dot / (Math.sqrt(docNorm) * Math.sqrt(qNorm)) : 0;
    if (score > 0) scored.push({ doc, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ doc, score }) => ({
    soul: doc.soul,
    score,
    snippet: makeSnippet(doc, qTokens),
  }));
}

/** Extract ~140 chars around the first query-term match. */
function makeSnippet(doc: IndexedDoc, qTokens: string[]): string {
  const text = `${doc.title} — ${doc.body}`;
  const lower = text.toLowerCase();
  for (const t of qTokens) {
    const idx = lower.indexOf(t);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + 100);
      return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
        end < text.length ? "…" : ""
      }`;
    }
  }
  return text.slice(0, 140);
}

/* ------------------------------------------------------------------ */
/*  Convenience: debounced search for UI hooks                         */
/* ------------------------------------------------------------------ */

export const debouncedSearch = debounce(
  (query: string, limit: number, cb: (hits: SearchHit[]) => void) => {
    void searchIndex(query, limit).then(cb);
  },
  250,
);