import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useGunSync, type GunPost } from "../hooks/useGunSync";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GitHubDiscussion {
  id: string;
  number: number;
  title: string;
  url: string;
  category: string;
  author: string;
  authorAvatar: string;
  replyCount: number;
  isAnswered: boolean;
  createdAt: string;
  labels: Array<{ name: string; color: string }>;
  _source: "github";
}

interface LocalPost {
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
  _source: "local";
}

interface Comment {
  id: string;
  postId: string;
  body: string;
  author: string;
  authorAvatar: string;
  authorId: number;
  createdAt: string;
}

type DiscussionItem = GitHubDiscussion | LocalPost | GunPost;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_COLORS: Record<string, string> = {
  Announcement: "bg-purple-500/20 text-purple-300",
  Ideas: "bg-emerald-500/20 text-emerald-300",
  Bug: "bg-red-500/20 text-red-300",
  Discussion: "bg-brand-600/20 text-brand-300",
  Tutorial: "bg-amber-500/20 text-amber-300",
  "Q&A": "bg-cyan-500/20 text-cyan-300",
  Poll: "bg-pink-500/20 text-pink-300",
  Show: "bg-orange-500/20 text-orange-300",
};

const DEFAULT_COLOR = "bg-white/10 text-white/50";
const VALID_CATEGORIES = [
  "Discussion",
  "Ideas",
  "Bug",
  "Tutorial",
  "Q&A",
  "Announcement",
  "Poll",
  "Show",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function catClass(cat: string): string {
  return CATEGORY_COLORS[cat] ?? DEFAULT_COLOR;
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function SkeletonList() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card-surface animate-pulse">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 shrink-0 rounded-full bg-white/5" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-20 rounded-full bg-white/5" />
              <div className="h-5 w-3/4 rounded bg-white/5" />
              <div className="flex gap-3">
                <div className="h-3 w-24 rounded bg-white/5" />
                <div className="h-3 w-16 rounded bg-white/5" />
              </div>
            </div>
            <div className="h-5 w-14 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal backdrop                                                     */
/* ------------------------------------------------------------------ */

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl shadow-black/40 max-h-[85vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create/Edit Post Modal                                             */
/* ------------------------------------------------------------------ */

function PostFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: { title: string; body: string; category: string };
  onSave: (data: {
    title: string;
    body: string;
    category: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Discussion");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ title: title.trim(), body: body.trim(), category });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-5 text-xl font-bold text-white/90">
        {initial ? "Edit post" : "New post"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-white/50">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-500/50 focus:bg-white/10"
            placeholder="What's on your mind?"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-white/50">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-500/50"
          >
            {VALID_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-white/50">
            Body <span className="text-white/30">(Markdown supported)</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={50000}
            required
            rows={8}
            className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-500/50 focus:bg-white/10"
            placeholder="Write your post content here..."
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim() || !body.trim()}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Publish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete confirmation dialog                                         */
/* ------------------------------------------------------------------ */

function DeleteDialog({
  title,
  onConfirm,
  onClose,
}: {
  title: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-2 text-lg font-bold text-white/90">Delete post</h2>
      <p className="mb-6 text-sm text-white/50">
        Are you sure you want to delete{" "}
        <span className="text-white/80">"{title}"</span>? This action cannot be
        undone.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Post Detail Modal (with comments)                                  */
/* ------------------------------------------------------------------ */

function PostDetailModal({
  post,
  onClose,
  onDeleted,
  onCommented,
}: {
  post: LocalPost;
  onClose: () => void;
  onDeleted: () => void;
  onCommented: () => void;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const r = await fetch(`/api/posts/comments?postId=${post.id}`);
      const data = (await r.json()) as { comments?: Comment[] };
      setComments(data.comments ?? []);
    } catch {
      /* ignore */
    }
    setLoadingComments(false);
  }, [post.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      const token = localStorage.getItem("pocwu_session_token");
      const r = await fetch("/api/posts/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId: post.id, body: replyText.trim() }),
      });
      if (!r.ok) throw new Error("Failed to reply");
      setReplyText("");
      await loadComments();
      onCommented();
    } catch {
      /* ignore */
    }
    setSending(false);
  };

  const handleDelete = async () => {
    const token = localStorage.getItem("pocwu_session_token");
    const r = await fetch(`/api/posts/${post.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error("Delete failed");
    onDeleted();
  };

  const isAuthor = user?.login === post.author;

  return (
    <Modal onClose={onClose}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <img
            src={post.authorAvatar}
            alt={post.author}
            className="h-9 w-9 rounded-full"
          />
          <div>
            <h2 className="text-lg font-bold text-white/90">{post.title}</h2>
            <p className="text-xs text-white/40">
              by {post.author} · {formatRelativeTime(post.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${catClass(post.category)}`}
          >
            {post.category}
          </span>
          {isAuthor && (
            <>
              <button
                onClick={() => setShowDelete(true)}
                className="rounded p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-red-400"
                title="Delete"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mb-6 whitespace-pre-wrap rounded-lg border border-white/5 bg-white/[0.02] p-4 text-sm text-white/70 leading-relaxed">
        {post.body}
      </div>

      {/* Comments */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white/50">
          Comments{" "}
          {comments.length > 0 && (
            <span className="text-white/30">({comments.length})</span>
          )}
        </h3>
        {loadingComments ? (
          <div className="py-4 text-center text-sm text-white/30">
            Loading comments…
          </div>
        ) : comments.length === 0 ? (
          <div className="py-4 text-center text-sm text-white/30">
            No comments yet. Be the first to reply!
          </div>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
            >
              <img
                src={c.authorAvatar}
                alt={c.author}
                className="mt-0.5 h-6 w-6 shrink-0 rounded-full"
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-white/70">
                    {c.author}
                  </span>
                  <span className="text-[11px] text-white/30">
                    {formatRelativeTime(c.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/60">
                  {c.body}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Reply form */}
      {user && (
        <form onSubmit={handleReply} className="mt-4 flex gap-2">
          <input
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply…"
            maxLength={10000}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-500/50"
          />
          <button
            type="submit"
            disabled={!replyText.trim() || sending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
          >
            {sending ? "…" : "Reply"}
          </button>
        </form>
      )}

      {/* Delete dialog */}
      {showDelete && (
        <DeleteDialog
          title={post.title}
          onConfirm={handleDelete}
          onClose={() => setShowDelete(false)}
        />
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Post Card                                                          */
/* ------------------------------------------------------------------ */

function PostCard({
  item,
  isAuthor,
  onEdit,
  onDelete,
  onClick,
}: {
  item: DiscussionItem;
  isAuthor: boolean;
  onEdit: (item: LocalPost) => void;
  onDelete: (item: LocalPost) => void;
  onClick: (item: LocalPost) => void;
}) {
  const isGithub = item._source === "github";
  const gh = isGithub ? (item as GitHubDiscussion) : null;
  const local = !isGithub ? (item as LocalPost) : null;

  return (
    <div
      className={`card-surface group relative transition-all ${
        local ? "cursor-pointer hover:border-brand-500/30" : ""
      }`}
      onClick={() => {
        if (local) onClick(local);
      }}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <img
          src={
            item.authorAvatar || `https://avatars.githubusercontent.com/u/0?v=4`
          }
          alt={item.author}
          className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-white/5"
          loading="lazy"
        />

        <div className="min-w-0 flex-1">
          {/* Badge row */}
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${catClass(item.category)}`}
            >
              {item.category}
            </span>
            {isGithub && (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/30">
                GitHub
              </span>
            )}
            {"isAnswered" in item && (item as LocalPost).isAnswered && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                    clipRule="evenodd"
                  />
                </svg>
                Answered
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-base font-medium text-white/90 transition-colors group-hover:text-brand-400">
            {item.title}
          </h3>

          {/* Meta */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/30">
            <span>
              by <span className="text-white/50">{item.author}</span>
            </span>
            <span>{formatRelativeTime(item.createdAt)}</span>
          </div>
        </div>

        {/* Reply count + actions */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1.5 text-sm text-white/30">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
              />
            </svg>
            <span>{item.replyCount}</span>
          </div>

          {/* Author actions (local posts only) */}
          {isAuthor && local && (
            <div
              className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onEdit(local)}
                className="rounded p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-brand-400"
                title="Edit"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                  />
                </svg>
              </button>
              <button
                onClick={() => onDelete(local)}
                className="rounded p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-red-400"
                title="Delete"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* GitHub link */}
          {isGithub && gh && (
            <a
              href={gh.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-white/20 opacity-0 transition-all hover:text-brand-400 group-hover:opacity-100"
              title="View on GitHub"
              onClick={(e) => e.stopPropagation()}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                        */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <div className="card-surface text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
        <svg
          className="h-6 w-6 text-white/30"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
          />
        </svg>
      </div>
      <h3 className="text-base font-medium text-white/70">
        No discussions yet
      </h3>
      <p className="mt-1 text-sm text-white/40">
        Be the first to start a conversation!
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function CommunityHub() {
  const { user } = useAuth();
  const { username, project } = useParams<{
    username?: string;
    project?: string;
  }>();
  const [items, setItems] = useState<DiscussionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("All");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPost, setEditingPost] = useState<LocalPost | null>(null);
  const [deletingPost, setDeletingPost] = useState<LocalPost | null>(null);
  const [viewingPost, setViewingPost] = useState<LocalPost | null>(null);

  // Derive scope display (💬 emoji = global alias for the main discussions view)
  const effectiveUsername = username === "💬" ? undefined : username;
  const isProjectHub = !!project;
  const isUserHub = !!effectiveUsername && !project;
  const scopeLabel = isProjectHub
    ? `${effectiveUsername}/${project}`
    : isUserHub
      ? `@${effectiveUsername}`
      : "Global";

  const { mergeGunPosts, publishCreated, publishDeleted } = useGunSync({
    onGunUpdate: () => {
      // When GunDB delivers a new post in real-time, re-merge with current items
      setItems((prev) => mergeGunPosts(prev));
    },
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scopeParams = effectiveUsername
        ? `&scopeUser=${encodeURIComponent(effectiveUsername)}${project ? `&scopeProject=${encodeURIComponent(project)}` : ""}`
        : "";
      const [ghResp, localResp] = await Promise.all([
        fetch(`/api/discussions?first=30${scopeParams}`),
        fetch(`/api/posts?limit=50${scopeParams}`),
      ]);

      const ghData = ghResp.ok
        ? ((await ghResp.json()) as { discussions: GitHubDiscussion[] })
        : { discussions: [] };
      const localData = localResp.ok
        ? ((await localResp.json()) as { posts: LocalPost[] })
        : { posts: [] };

      const gh: DiscussionItem[] = (ghData.discussions ?? []).map((d) => ({
        ...d,
        _source: "github" as const,
      }));
      const local: DiscussionItem[] = (localData.posts ?? []).map((p) => ({
        ...p,
        _source: "local" as const,
      }));

      // Merge REST data with GunDB-synced posts
      const merged = mergeGunPosts([...gh, ...local]).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      setItems(merged);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load discussions",
      );
    } finally {
      setLoading(false);
    }
  }, [mergeGunPosts]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Derive categories
  const availableCategories = ["All", ...new Set(items.map((i) => i.category))];
  const filtered =
    activeCategory === "All"
      ? items
      : items.filter((i) => i.category === activeCategory);

  // Create post
  const handleCreate = async (data: {
    title: string;
    body: string;
    category: string;
  }) => {
    const token = localStorage.getItem("pocwu_session_token");
    const r = await fetch("/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "Failed to create");
    }
    const created = (await r.json()) as { post: LocalPost };
    // Publish to GunDB for real-time sync
    publishCreated(created.post);
    await fetchAll();
  };

  // Edit post
  const handleEdit = async (data: {
    title: string;
    body: string;
    category: string;
  }) => {
    if (!editingPost) return;
    const token = localStorage.getItem("pocwu_session_token");
    const r = await fetch(`/api/posts/${editingPost.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "Failed to update");
    }
    setEditingPost(null);
    await fetchAll();
  };

  // Delete post
  const handleDeleteConfirm = async () => {
    if (!deletingPost) return;
    const token = localStorage.getItem("pocwu_session_token");
    const r = await fetch(`/api/posts/${deletingPost.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error("Delete failed");
    // Remove from GunDB graph
    publishDeleted(deletingPost.id);
    setDeletingPost(null);
    setViewingPost(null);
    await fetchAll();
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-16 pb-24">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              Community <span className="text-brand-400">Hub</span>
            </h1>
            {isProjectHub && (
              <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-medium text-brand-400">
                📁 {scopeLabel}
              </span>
            )}
            {isUserHub && (
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                🌐 {scopeLabel}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-white/40">
            {username === "💬"
              ? "Main Community Hub — GitHub Discussions powered, all content loads natively in-app."
              : isProjectHub
                ? `Discussions scoped to the ${scopeLabel} project.`
                : isUserHub
                  ? `Community discussions for ${scopeLabel}.`
                  : "All community discussions across the ecosystem."}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-sm text-white/40">
              {loading
                ? "Loading…"
                : `${items.length} discussion${items.length === 1 ? "" : "s"}`}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>
        </div>
        {user && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            New Post
          </button>
        )}
      </div>

      {/* Category filters */}
      {!loading && !error && items.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {availableCategories.map((cat) => {
            const count =
              cat === "All"
                ? items.length
                : items.filter((i) => i.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-brand-600/20 text-brand-300"
                    : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60"
                }`}
              >
                {cat}
                <span className="ml-1.5 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      {loading && <SkeletonList />}
      {!loading && error && (
        <div className="card-surface border-red-500/20 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchAll}
            className="mt-3 rounded-lg bg-brand-600/20 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-brand-600/30"
          >
            Try again
          </button>
        </div>
      )}
      {!loading && !error && filtered.length === 0 && <EmptyState />}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((item) => (
            <PostCard
              key={`${item._source}-${item.id}`}
              item={item}
              isAuthor={user?.login === item.author}
              onEdit={(p) => setEditingPost(p)}
              onDelete={(p) => setDeletingPost(p)}
              onClick={(p) => setViewingPost(p)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <PostFormModal
          onSave={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}
      {editingPost && (
        <PostFormModal
          initial={{
            title: editingPost.title,
            body: editingPost.body,
            category: editingPost.category,
          }}
          onSave={handleEdit}
          onClose={() => setEditingPost(null)}
        />
      )}
      {deletingPost && (
        <DeleteDialog
          title={deletingPost.title}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeletingPost(null)}
        />
      )}
      {viewingPost && (
        <PostDetailModal
          post={viewingPost}
          onClose={() => setViewingPost(null)}
          onDeleted={() => setViewingPost(null)}
          onCommented={() => fetchAll()}
        />
      )}
    </div>
  );
}
