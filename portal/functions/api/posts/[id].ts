/**
 * Single Post API
 *
 * GET    /api/posts/:id  — Get a single post
 * PATCH  /api/posts/:id  — Update a post (must be author)
 * DELETE /api/posts/:id  — Delete a post (must be author)
 */

import { json, getSession, type Env } from "../_shared";

/* ------------------------------------------------------------------ */
/*  GET — single post                                                  */
/* ------------------------------------------------------------------ */

async function handleGet(env: Env, postId: string): Promise<Response> {
  if (!env.DB) return json({ error: "Database not available" }, 503);

  try {
    const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(postId).first();
    if (!post) return json({ error: "Post not found" }, 404);

    // Fetch comments
    const comments = await env.DB.prepare(
      "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC",
    ).bind(postId).all();

    return json({
      post: mapRow(post as Record<string, unknown>),
      comments: (comments.results ?? []).map(mapCommentRow),
    });
  } catch (err) {
    console.error("Post get error:", err);
    return json({ error: "Failed to fetch post" }, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH — update post                                                */
/* ------------------------------------------------------------------ */

async function handlePatch(request: Request, env: Env, postId: string): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Authentication required" }, 401);

  if (!env.DB) return json({ error: "Database not available" }, 503);

  // Verify ownership
  const existing = await env.DB.prepare("SELECT author FROM posts WHERE id = ?").bind(postId).first<{ author: string }>();
  if (!existing) return json({ error: "Post not found" }, 404);
  if (existing.author !== session.user.login) return json({ error: "Not authorized to edit this post" }, 403);

  let body: { title?: string; body?: string; category?: string };
  try {
    body = await request.json() as { title?: string; body?: string; category?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return json({ error: "Title cannot be empty" }, 400);
    if (t.length > 200) return json({ error: "Title too long" }, 400);
    updates.push("title = ?");
    params.push(t);
  }
  if (body.body !== undefined) {
    const b = body.body.trim();
    if (!b) return json({ error: "Body cannot be empty" }, 400);
    if (b.length > 50000) return json({ error: "Body too long" }, 400);
    updates.push("body = ?");
    params.push(b);
  }
  if (body.category !== undefined) {
    const VALID_CATEGORIES = ["Announcement", "Ideas", "Discussion", "Bug", "Tutorial", "Q&A", "Poll", "Show"];
    if (!VALID_CATEGORIES.includes(body.category)) {
      return json({ error: "Invalid category" }, 400);
    }
    updates.push("category = ?");
    params.push(body.category);
  }

  if (updates.length === 0) return json({ error: "No fields to update" }, 400);

  updates.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(postId);

  try {
    await env.DB.prepare(
      `UPDATE posts SET ${updates.join(", ")} WHERE id = ?`,
    ).bind(...params).run();

    const updated = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(postId).first();
    return json({ post: mapRow(updated as Record<string, unknown>) });
  } catch (err) {
    console.error("Post update error:", err);
    return json({ error: "Failed to update post" }, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE — delete post                                               */
/* ------------------------------------------------------------------ */

async function handleDelete(request: Request, env: Env, postId: string): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Authentication required" }, 401);

  if (!env.DB) return json({ error: "Database not available" }, 503);

  // Verify ownership
  const existing = await env.DB.prepare("SELECT author FROM posts WHERE id = ?").bind(postId).first<{ author: string }>();
  if (!existing) return json({ error: "Post not found" }, 404);
  if (existing.author !== session.user.login) return json({ error: "Not authorized to delete this post" }, 403);

  try {
    // CASCADE should handle comments
    await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(postId).run();
    return json({ ok: true });
  } catch (err) {
    console.error("Post delete error:", err);
    return json({ error: "Failed to delete post" }, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mapRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    author: row.author,
    authorAvatar: row.author_avatar,
    authorId: row.author_id,
    isAnswered: (row.is_answered as number) === 1,
    isPinned: (row.is_pinned as number) === 1,
    replyCount: row.reply_count as number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCommentRow(row: Record<string, unknown>) {
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
  const { request, env, params } = context;
  const postId = (params as Record<string, string>).id;

  if (!postId) return json({ error: "Post ID is required" }, 400);

  switch (request.method) {
    case "GET":
      return handleGet(env, postId);
    case "PATCH":
      return handlePatch(request, env, postId);
    case "DELETE":
      return handleDelete(request, env, postId);
    default:
      return json({ error: "Method not allowed" }, 405);
  }
};
