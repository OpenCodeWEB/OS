/**
 * Community Posts API
 *
 * GET  /api/posts          — List all posts (paginated, newest first)
 * POST /api/posts          — Create a new post (requires auth)
 */

import { json, getSession, uuid, type Env, type SessionData } from "./_shared";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Post {
  id: string;
  title: string;
  body: string;
  category: string;
  author: string;
  authorAvatar: string;
  authorId: number;
  isAnswered: boolean;
  isPinned: boolean;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  GET — list posts                                                   */
/* ------------------------------------------------------------------ */

async function handleGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50") || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0") || 0, 0);
  const category = url.searchParams.get("category");

  if (!env.DB) return json({ error: "Database not available" }, 503);

  let query = "SELECT * FROM posts";
  let countQuery = "SELECT COUNT(*) as total FROM posts";
  const params: unknown[] = [];
  const countParams: unknown[] = [];

  if (category && category !== "All") {
    query += " WHERE category = ?";
    countQuery += " WHERE category = ?";
    params.push(category);
    countParams.push(category);
  }

  query += " ORDER BY is_pinned DESC, created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  try {
    const [rowsResult, countResult] = await Promise.all([
      env.DB.prepare(query).bind(...params).all(),
      env.DB.prepare(countQuery).bind(...countParams).all(),
    ]);

    const posts = (rowsResult.results ?? []).map(mapRow);
    const total = (countResult.results?.[0] as { total: number } | undefined)?.total ?? 0;

    return json({ posts, total });
  } catch (err) {
    console.error("Posts list error:", err);
    return json({ error: "Failed to fetch posts" }, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  POST — create a post                                               */
/* ------------------------------------------------------------------ */

async function handlePost(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Authentication required" }, 401);

  let body: { title?: string; body?: string; category?: string };
  try {
    body = await request.json() as { title?: string; body?: string; category?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const title = (body.title ?? "").trim();
  const postBody = (body.body ?? "").trim();
  const category = (body.category ?? "Discussion").trim();

  if (!title) return json({ error: "Title is required" }, 400);
  if (title.length > 200) return json({ error: "Title too long (max 200 chars)" }, 400);
  if (!postBody) return json({ error: "Body is required" }, 400);
  if (postBody.length > 50000) return json({ error: "Body too long (max 50K chars)" }, 400);

  const VALID_CATEGORIES = ["Announcement", "Ideas", "Discussion", "Bug", "Tutorial", "Q&A", "Poll", "Show"];
  if (!VALID_CATEGORIES.includes(category)) {
    return json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` }, 400);
  }

  if (!env.DB) return json({ error: "Database not available" }, 503);

  const id = uuid();
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO posts (id, title, body, category, author, author_avatar, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, title, postBody, category, session.user.login, session.user.avatar, session.user.id, now, now)
      .run();

    return json({ post: { id, title, body: postBody, category, author: session.user.login, authorAvatar: session.user.avatar, authorId: session.user.id, isAnswered: false, isPinned: false, replyCount: 0, createdAt: now, updatedAt: now } }, 201);
  } catch (err) {
    console.error("Post create error:", err);
    return json({ error: "Failed to create post" }, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mapRow(row: Record<string, unknown>): Post {
  return {
    id: row.id as string,
    title: row.title as string,
    body: row.body as string,
    category: row.category as string,
    author: row.author as string,
    authorAvatar: row.author_avatar as string,
    authorId: row.author_id as number,
    isAnswered: (row.is_answered as number) === 1,
    isPinned: (row.is_pinned as number) === 1,
    replyCount: row.reply_count as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  switch (request.method) {
    case "GET":
      return handleGet(request, env);
    case "POST":
      return handlePost(request, env);
    default:
      return json({ error: "Method not allowed" }, 405);
  }
};
