/**
 * Post Comments API
 *
 * GET  /api/posts/comments?postId=xxx  — List comments for a post
 * POST /api/posts/comments             — Add a comment (requires auth)
 */

import { json, getSession, uuid, type Env } from "../_shared";

/* ------------------------------------------------------------------ */
/*  GET — list comments                                                */
/* ------------------------------------------------------------------ */

async function handleGet(request: Request, env: Env): Promise<Response> {
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId) return json({ error: "postId query param is required" }, 400);

  if (!env.DB) return json({ error: "Database not available" }, 503);

  try {
    const comments = await env.DB.prepare(
      "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC",
    ).bind(postId).all();

    return json({ comments: (comments.results ?? []).map(mapRow) });
  } catch (err) {
    console.error("Comments list error:", err);
    return json({ error: "Failed to load comments" }, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  POST — add comment                                                 */
/* ------------------------------------------------------------------ */

async function handlePost(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Authentication required" }, 401);

  let body: { postId?: string; body?: string };
  try {
    body = await request.json() as { postId?: string; body?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const postId = (body.postId ?? "").trim();
  const commentBody = (body.body ?? "").trim();

  if (!postId) return json({ error: "postId is required" }, 400);
  if (!commentBody) return json({ error: "Comment body is required" }, 400);
  if (commentBody.length > 10000) return json({ error: "Comment too long (max 10K chars)" }, 400);

  if (!env.DB) return json({ error: "Database not available" }, 503);

  // Verify post exists
  const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(postId).first();
  if (!post) return json({ error: "Post not found" }, 404);

  const id = uuid();
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO comments (id, post_id, body, author, author_avatar, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, postId, commentBody, session.user.login, session.user.avatar, session.user.id, now).run();

    // Increment reply count
    await env.DB.prepare("UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?").bind(postId).run();

    return json({
      comment: { id, postId, body: commentBody, author: session.user.login, authorAvatar: session.user.avatar, authorId: session.user.id, createdAt: now },
    }, 201);
  } catch (err) {
    console.error("Comment create error:", err);
    return json({ error: "Failed to add comment" }, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mapRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    postId: row.post_id,
    body: row.body,
    author: row.author,
    authorAvatar: row.author_avatar,
    authorId: row.author_id,
    createdAt: row.created_at,
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
