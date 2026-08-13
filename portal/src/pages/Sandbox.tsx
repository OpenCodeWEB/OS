import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

interface SandboxRepoData {
  repo: {
    full_name: string;
    html_url: string;
    visibility: "public" | "private";
    default_branch: string;
    pushed_at: string | null;
    created_at: string;
    archived: boolean;
    description: string | null;
    size_kb: number;
  };
  commits: number;
  latest: {
    sha: string;
    short: string;
    message: string;
    author: string;
    date: string | null;
  } | null;
  branches: string[];
  backups: number;
}

interface SandboxProject {
  id: string;
  name: string;
  org: string;
  owner: string;
  status: "creating" | "running" | "preview" | "stopped";
  isolation: "strict" | "shared";
  autoBackup: boolean;
  createdAt: string;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Sandbox() {
  const { org, project } = useParams<{ org: string; project: string }>();

  const [data, setData] = useState<SandboxRepoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<SandboxProject | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!org || !project) return;
    setLoading(true);
    setError(null);
    fetch(
      `/api/ag/sandbox?org=${encodeURIComponent(org)}&name=${encodeURIComponent(project)}`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error);
          setData(null);
        } else {
          setData(j.sandbox as SandboxRepoData);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to reach the sandbox service.");
        setLoading(false);
      });
  }, [org, project]);

  useEffect(() => {
    load();
  }, [load]);

  if (!org || !project) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-white/40">Invalid sandbox path.</p>
      </div>
    );
  }

  const createSandbox = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const resp = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim() || project,
          org: "OpenCodeWEB",
        }),
      });
      const j = await resp.json();
      if (!resp.ok) {
        setCreateError(j.error ?? "Failed to create sandbox project.");
      } else {
        setCreated(j.sandbox as SandboxProject);
        setProjectName("");
      }
    } catch {
      setCreateError("Failed to reach the sandbox API.");
    } finally {
      setCreating(false);
    }
  };

  const publish = async () => {
    if (!created) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const resp = await fetch(`/api/sandbox/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "preview" }),
      });
      const j = await resp.json();
      if (!resp.ok) {
        setPublishError(j.error ?? "Publish failed.");
      } else {
        setPublished(true);
      }
    } catch {
      setPublishError("Failed to reach the sandbox API.");
    } finally {
      setPublishing(false);
    }
  };

  const connected = data !== null && !error;
  const backups = data?.backups ?? 0;
  const latest = data?.latest;

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      {/* Sandbox header */}
      <div className="mb-12">
        <div className="mb-2 flex items-center gap-3">
          <span className="badge">Sandbox</span>
          {connected && !data?.repo.archived ? (
            <span className="badge bg-emerald-500/20 text-emerald-300">
              Connected
            </span>
          ) : (
            <span className="badge bg-amber-500/20 text-amber-300">
              {loading ? "Connecting…" : "Not Connected"}
            </span>
          )}
          {published && (
            <span className="badge bg-brand-500/20 text-brand-300">
              Published
            </span>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {org}/{project}
        </h1>
        <p className="mt-2 text-white/40">
          {data?.repo.description ??
            "Isolated sandboxed runtime with auto-backup and preview pipeline."}
        </p>
        {connected && (
          <a
            href={data?.repo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm text-brand-400 hover:text-brand-300"
          >
            Open on GitHub →
          </a>
        )}
      </div>

      {loading && (
        <div className="card-surface mb-8 p-8 text-center text-white/40">
          Loading live sandbox state…
        </div>
      )}

      {error && (
        <div className="card-surface mb-8 border border-amber-500/20 p-6">
          <p className="text-sm text-amber-300/90">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:border-white/25"
          >
            Retry
          </button>
        </div>
      )}

      {/* Sandbox status — real data from the connected GitHub repo */}
      {connected && data && (
        <>
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <div className="card-surface">
              <div className="text-sm text-white/40">Status</div>
              <div className="mt-1 text-lg font-semibold text-emerald-400">
                {data.repo.archived ? "Archived" : "Running"}
              </div>
            </div>
            <div className="card-surface">
              <div className="text-sm text-white/40">Isolation</div>
              <div className="mt-1 text-lg font-semibold capitalize">
                {data.repo.visibility}
              </div>
            </div>
            <div className="card-surface">
              <div className="text-sm text-white/40">Auto-Backup</div>
              <div className="mt-1 text-lg font-semibold text-brand-400">
                {backups > 0 ? `${backups} snapshot${backups === 1 ? "" : "s"}` : "Enabled"}
              </div>
            </div>
          </div>

          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <div className="card-surface">
              <div className="text-sm text-white/40">Commits · {data.repo.default_branch}</div>
              <div className="mt-1 text-lg font-semibold">{data.commits}</div>
            </div>
            <div className="card-surface">
              <div className="text-sm text-white/40">Last Push</div>
              <div className="mt-1 text-lg font-semibold">
                {timeAgo(data.repo.pushed_at)}
              </div>
            </div>
            <div className="card-surface">
              <div className="text-sm text-white/40">Branches</div>
              <div className="mt-1 text-lg font-semibold">{data.branches.length}</div>
            </div>
          </div>

          {/* Latest commit */}
          <div className="card-surface mb-8 p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-white/40">
              Latest Commit
            </div>
            {latest ? (
              <div className="mt-2">
                <div className="font-mono text-sm text-emerald-300">{latest.short}</div>
                <div className="mt-1 text-sm text-white/80">{latest.message}</div>
                <div className="mt-1 text-xs text-white/40">
                  {latest.author} · {timeAgo(latest.date)}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-white/40">No commits yet.</p>
            )}
          </div>
        </>
      )}

      {/* Preview + lifecycle actions */}
      <div className="card-surface mb-8 flex min-h-[200px] flex-col items-center justify-center p-8">
        {created ? (
          <>
            <div className="mb-1 text-4xl">{published ? "✅" : "🚀"}</div>
            <p className="text-lg font-medium">
              Sandbox Project {published ? "Published" : "Created"}
            </p>
            <p className="mt-2 max-w-md text-center text-sm text-white/40">
              <span className="font-mono text-white/60">{created.name}</span> ·{" "}
              {created.status}
              {published ? " → preview" : ""} · auto-backup{" "}
              {created.autoBackup ? "enabled" : "disabled"}
            </p>
            {!published && (
              <button
                onClick={publish}
                disabled={publishing}
                className="mt-6 rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {publishing ? "Publishing…" : "Publish to Live"}
              </button>
            )}
            {publishError && (
              <p className="mt-3 text-sm text-red-400">{publishError}</p>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 text-4xl">🚀</div>
            <p className="text-lg font-medium">Live Preview</p>
            <p className="mt-2 max-w-md text-center text-sm text-white/40">
              {connected
                ? "This sandbox is connected to a live GitHub repository. Create a sandbox project to run the preview lifecycle."
                : "Sandboxed preview will render here. Changes are applied in preview mode first, then published with explicit approval."}
            </p>
            <div className="mt-6 flex w-full max-w-md flex-col items-center gap-3">
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Sandbox project name (default: current project)"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-brand-500/50 focus:outline-none"
              />
              <button
                onClick={createSandbox}
                disabled={creating}
                className="w-full rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create Sandbox Project"}
              </button>
              {createError && (
                <p className="text-sm text-red-400">{createError}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Scope guardrail notice */}
      <div className="mt-8 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-sm text-amber-300/80">
          <span className="font-semibold">Scope Escalation Guardrail:</span> Any
          request to access filesystem paths outside the designated sandbox
          directory requires explicit human approval.
        </p>
      </div>
    </div>
  );
}
