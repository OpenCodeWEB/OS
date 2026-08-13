/**
 * OpenCodeWEB OS — AiA Connector Worker
 *
 * Serves the AiA Master Intelligence Engine's remote endpoints:
 *
 *   GET  /health          status probe (public, for CI/uptime)
 *   POST /sync            ingest a batch of learned lessons
 *                         body: { "lessons": [Lesson...], "source": "..." }
 *   GET  /lessons         list persisted lessons (latest first, ?limit=N)
 *   GET  /lessons/:id     fetch a single lesson by id
 *   POST /research        lightweight web research (fetch + extract)
 *                         body: { "query": "...", "source": "https://..." }
 *
 * Persistence design (Zero-Constraint + platform-cap aware):
 *   - ONE KV key (`store:lessons`) holds the whole lesson store, so a sync
 *     batch costs exactly ONE KV write regardless of batch size. Cloudflare
 *     free-tier KV caps daily writes (~1,000/account), so we never burn
 *     quota per lesson; real usage consumes a handful of writes per day.
 *   - If the KV write is rejected (quota/temporary), we buffer in memory and
 *     still return `ok:true` so the engine's retry cadence covers the gap.
 *
 * Zero-Constraint Policy: no token limits, no throttling, no artificial
 * quotas in our code.
 *
 * Maintainers: ABsUP & ABsUPs
 */
export interface Env {
  AIA_LESSONS: KVNamespace;
  ENVIRONMENT?: string;
}

const STORE_KEY = "store:lessons";
const MAX_LESSONS_STORED = 50_000;

// In-memory fallback used when KV writes are quota-blocked.
const memoryStore: { lessons: StoredLesson[] } = { lessons: [] };

interface StoredLesson {
  id: string;
  synced_at: string;
  source: string;
  [key: string]: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // CORS
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gateway-Token",
      "Content-Type": "application/json",
    };
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // ---- Health -------------------------------------------------------
      if (url.pathname === "/health" && method === "GET") {
        return new Response(
          JSON.stringify({
            status: "Online",
            service: "aia-connector",
            endpoint: "aia.xup.workers.dev",
            version: "1.1.0",
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: cors }
        );
      }

      // ---- Sync lessons --------------------------------------------------
      if (url.pathname === "/sync" && method === "POST") {
        return await handleSync(request, env, cors);
      }

      // ---- List lessons ---------------------------------------------------
      if (url.pathname === "/lessons" && method === "GET") {
        return await handleList(request, env, cors);
      }

      // ---- Single lesson --------------------------------------------------
      const lessonMatch = url.pathname.match(/^\/lessons\/([^/]+)$/);
      if (lessonMatch && method === "GET") {
        return await handleGetOne(lessonMatch[1], env, cors);
      }

      // ---- Research -------------------------------------------------------
      if (url.pathname === "/research" && method === "POST") {
        return await handleResearch(request, cors);
      }

      // ---- Fallback --------------------------------------------------------
      return new Response(
        JSON.stringify({
          service: "aia-connector",
          endpoints: ["/health", "/sync", "/lessons", "/lessons/:id", "/research"],
        }),
        { status: 200, headers: cors }
      );
    } catch (err) {
      console.error("AiA connector error:", err);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          message: err instanceof Error ? err.message : "Unknown error",
        }),
        { status: 500, headers: cors }
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

async function readStore(env: Env): Promise<StoredLesson[]> {
  try {
    const raw = await env.AIA_LESSONS.get(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { lessons?: StoredLesson[] };
      if (Array.isArray(parsed.lessons)) return parsed.lessons;
    }
  } catch (err) {
    console.warn("KV read failed, using memory store:", err);
  }
  return memoryStore.lessons;
}

async function writeStore(env: Env, lessons: StoredLesson[]): Promise<boolean> {
  try {
    await env.AIA_LESSONS.put(STORE_KEY, JSON.stringify({ lessons, updated_at: Date.now() }));
    memoryStore.lessons = lessons;
    return true;
  } catch (err) {
    console.warn("KV write failed (quota?); buffering in memory:", err);
    memoryStore.lessons = lessons;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleSync(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const payload = (await request.json().catch(() => null)) as
    | { lessons?: unknown[]; source?: string }
    | null;

  if (!payload || !Array.isArray(payload.lessons) || payload.lessons.length === 0) {
    return new Response(JSON.stringify({ error: "lessons[] required" }), { status: 400, headers: cors });
  }

  const incoming = payload.lessons;
  const source = payload.source || "unknown";
  const now = new Date().toISOString();

  const existing = await readStore(env);
  const byId = new Map<string, StoredLesson>();
  for (const l of existing) byId.set(l.id, l);

  let stored = 0;
  let skipped = 0;
  for (const lesson of incoming) {
    if (!lesson || typeof lesson !== "object") {
      skipped++;
      continue;
    }
    const id = (lesson as { id?: string }).id || crypto.randomUUID();
    byId.set(id, { ...(lesson as Record<string, unknown>), id, synced_at: now, source } as StoredLesson);
    stored++;
  }

  // Keep the store bounded (drop oldest by insertion order = array order).
  let merged = [...byId.values()];
  if (merged.length > MAX_LESSONS_STORED) {
    merged = merged.slice(merged.length - MAX_LESSONS_STORED);
  }

  const persisted = await writeStore(env, merged);

  return new Response(
    JSON.stringify({
      ok: true,
      stored,
      skipped,
      total: merged.length,
      persisted,
      buffered: !persisted,
      source,
      note: "OpenCodeWEB OS — Zero-Constraint: no limits, no throttling.",
    }),
    { status: 200, headers: cors }
  );
}

async function handleList(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const limitRaw = new URL(request.url).searchParams.get("limit");
  const limit = Math.min(parseInt(limitRaw || "50", 10) || 50, 500);

  const lessons = await readStore(env);
  // Latest first.
  lessons.sort((a, b) => (b.synced_at || "").localeCompare(a.synced_at || ""));

  return new Response(JSON.stringify({ count: Math.min(lessons.length, limit), lessons: lessons.slice(0, limit) }), {
    status: 200,
    headers: cors,
  });
}

async function handleGetOne(id: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const decoded = decodeURIComponent(id);
  const lessons = await readStore(env);
  const lesson = lessons.find((l) => l.id === decoded);
  if (!lesson) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cors });
  }
  return new Response(JSON.stringify(lesson), { status: 200, headers: cors });
}

async function handleResearch(request: Request, cors: Record<string, string>): Promise<Response> {
  const payload = (await request.json().catch(() => null)) as { query?: string; source?: string } | null;
  const query = (payload?.query || "").trim();

  if (!query) {
    return new Response(JSON.stringify({ error: "query required" }), { status: 400, headers: cors });
  }

  // Direct source fetch when the caller supplies a URL.
  const target = payload?.source?.trim();
  if (target && /^https?:\/\//.test(target)) {
    const fetched = await fetch(target, { headers: { "User-Agent": "OpenCodeWEB-AiA/1.0" } });
    const text = await fetched.text();
    return new Response(text.slice(0, 20000), {
      status: 200,
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Lightweight research: pull the top results from a public search page and
  // return their titles/links as text (no external API key required).
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();

  const results: { title: string; url: string }[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && results.length < 8) {
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    results.push({ title, url: m[1] });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < 8) {
    snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
  }

  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${snippets[i] || ""}`);

  return new Response(lines.join("\n\n").slice(0, 20000), {
    status: 200,
    headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
  });
}