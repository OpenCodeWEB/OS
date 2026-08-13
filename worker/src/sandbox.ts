/**
 * Sandbox repo status endpoint.
 *
 * GET /api/sandbox?org=<owner>&name=<repo>
 *
 * Returns REAL GitHub state for a connected sandbox repository:
 *   - repo metadata (visibility, default branch, last push, archived)
 *   - total commits on the default branch (Link-header count)
 *   - latest commit (sha, message, author, date)
 *   - branch list + count of `backup/*` snapshot branches
 *
 * Read-only. Tenant-gated via ALLOWED_ACCOUNTS (same isolation as the
 * rest of the worker). Whitelisted before the gateway guard so the
 * Pages Function service binding can call it directly; the gateway
 * proxy also exposes it as /api/ag/sandbox (strips to /sandbox).
 */

import type { Env } from "./_shared.js";
import { json, isAccountAllowed } from "./_shared.js";
import { generateAppJwt, getInstallationToken } from "../../src/auth/github.js";
import { githubFetch } from "../../src/github-api.js";

const GITHUB_API = "https://api.github.com";

function gh(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "OpenCodeWEB/1.0",
  };
}

/** Parse `Link: <...?page=N&per_page=1>; rel="last"` → N (total count). */
function linkLastPage(link: string | null): number | null {
  if (!link) return null;
  const m = link.match(/page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

export async function handleSandboxRepo(
  env: Env,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const org = (url.searchParams.get("org") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim();

  if (!org || !name) {
    return json(
      { error: "Both org and name query parameters are required." },
      400,
    );
  }

  // Tenant isolation — sandbox access mirrors the allowed accounts.
  if (!isAccountAllowed(env, org)) {
    return json(
      { error: `Account "${org}" is not authorized for sandbox access.` },
      403,
    );
  }

  if (!env.APP_ID || !env.PRIVATE_KEY || !env.INSTALLATION_ID) {
    return json({ error: "GitHub App not configured." }, 503);
  }

  try {
    const config = {
      appId: env.APP_ID,
      privateKey: env.PRIVATE_KEY,
      installationId: env.INSTALLATION_ID,
    };
    const jwt = await generateAppJwt(config);
    const { token } = await getInstallationToken(jwt, env.INSTALLATION_ID);

    const fullName = `${org}/${name}`;

    // Parallel reads — 3 subrequests, far below the Worker limit.
    const [repoResp, commitsResp, branchesResp] = await Promise.all([
      githubFetch(`${GITHUB_API}/repos/${fullName}`, {
        headers: gh(token),
      }),
      githubFetch(`${GITHUB_API}/repos/${fullName}/commits?per_page=1`, {
        headers: gh(token),
      }),
      githubFetch(`${GITHUB_API}/repos/${fullName}/branches?per_page=100`, {
        headers: gh(token),
      }),
    ]);

    if (repoResp.status === 404 || commitsResp.status === 404) {
      return json({ error: `Repository ${fullName} not found.` }, 404);
    }
    if (!repoResp.ok || !commitsResp.ok || !branchesResp.ok) {
      return json(
        {
          error: "GitHub API error",
          statuses: [repoResp.status, commitsResp.status, branchesResp.status],
        },
        502,
      );
    }

    const repo = (await repoResp.json()) as {
      full_name: string;
      html_url: string;
      private: boolean;
      default_branch: string;
      pushed_at: string | null;
      created_at: string;
      archived: boolean;
      description: string | null;
      size: number;
    };

    // Commits: per_page=1 → rel="last" page == total count on default branch.
    const commitTotal = linkLastPage(commitsResp.headers.get("Link")) ?? 0;
    const commits = (await commitsResp.json()) as Array<{
      sha: string;
      commit: {
        message: string;
        author?: { name?: string; date?: string };
      };
      author?: { login?: string } | null;
    }>;
    const latest = commits[0]
      ? {
          sha: commits[0].sha,
          short: commits[0].sha.slice(0, 7),
          message: commits[0].commit.message.split("\n")[0],
          author:
            commits[0].author?.login ??
            commits[0].commit.author?.name ??
            "unknown",
          date: commits[0].commit.author?.date ?? null,
        }
      : null;

    const branches = (await branchesResp.json()) as Array<{ name: string }>;
    const branchNames = branches.map((b) => b.name).sort();
    const backups = branchNames.filter((b) => b.startsWith("backup/")).length;

    const data = {
      repo: {
        full_name: repo.full_name,
        html_url: repo.html_url,
        visibility: repo.private ? "private" : "public",
        private: repo.private,
        default_branch: repo.default_branch,
        pushed_at: repo.pushed_at,
        created_at: repo.created_at,
        archived: repo.archived,
        description: repo.description,
        size_kb: repo.size,
      },
      commits: commitTotal,
      latest,
      branches: branchNames,
      backups,
    };

    return new Response(JSON.stringify({ ok: true, sandbox: data }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30, s-maxage=60",
      },
    });
  } catch (err) {
    return json(
      {
        error: "Sandbox lookup failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      502,
    );
  }
}
