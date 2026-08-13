/**
 * GitHub webhook event handler â€” full processing pipeline.
 *
 * 1. Verify HMAC-SHA256 signature using WEBHOOK_SECRET.
 * 2. Parse the X-GitHub-Event header.
 * 3. Dispatch to the appropriate handler based on event type.
 * 4. Each handler responds 200 immediately and uses ctx.waitUntil
 *    for background processing (backup, scan, fix, comment).
 */

import type { Env, InstallRecord } from "../_shared.js";
import { json } from "../_shared.js";
import { isAccountAllowed } from "../_shared.js";
import { recordMetricsEvent } from "../metrics.js";
import { githubFetch } from "../../../src/github-api.js";
import {
  generateAppJwt,
  getInstallationToken,
} from "../../../src/auth/github.js";
import { createBackup, recordBackup } from "../../../src/backup/fork-engine.js";
import { scanFiles, issuesToLedger } from "../../../src/scanner/ast-inspector.js";
import {
  applyAutoFixes,
  buildCommitMessage,
  createFixBranchName,
} from "../../../src/fixer/auto-repair.js";
import type { GitHubAppConfig, InstallationToken } from "../../../src/auth/github.js";
import type { BackupResult } from "../../../src/backup/fork-engine.js";
import type { ScanResult, DetectedIssue } from "../../../src/scanner/ast-inspector.js";
import type { FixResult } from "../../../src/fixer/auto-repair.js";

const GITHUB_API = "https://api.github.com";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Get the installation ID from a webhook payload.
 *  GitHub App webhooks include `payload.installation`; classic repo
 *  webhooks do not — fall back to the worker's INSTALLATION_ID secret
 *  so repo-level hooks still trigger the full pipeline. */
function getInstallationId(
  payload: Record<string, unknown>,
  env?: Env,
): string | null {
  const inst = payload.installation as Record<string, unknown> | undefined;
  if (inst?.id) return String(inst.id);
  if (env?.INSTALLATION_ID) return env.INSTALLATION_ID;
  return null;
}

/** Build the GitHubAppConfig from env vars + dynamic installation ID. */
function buildAppConfig(env: Env, installationId: string): GitHubAppConfig {
  return {
    appId: env.APP_ID!,
    privateKey: env.PRIVATE_KEY!,
    installationId,
  };
}

/** Get an installation access token (cached in KV). */
async function getAccessToken(
  env: Env,
  installationId: string,
): Promise<InstallationToken> {
  const cacheKey = `ag_token:${installationId}`;

  // Check KV cache first
  if (env.AG_TOKENS_KV) {
    const cached = await env.AG_TOKENS_KV.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { token: string; expiresAt: string };
        // If still valid for at least 5 minutes, reuse it
        if (new Date(parsed.expiresAt).getTime() > Date.now() + 300_000) {
          return {
            token: parsed.token,
            expiresAt: new Date(parsed.expiresAt),
            permissions: {},
            repositorySelection: "all",
          };
        }
      } catch {
        // Ignore parse errors, fetch fresh
      }
    }
  }

  // Fetch fresh token
  const config = buildAppConfig(env, installationId);
  const jwt = await generateAppJwt(config);
  const token = await getInstallationToken(jwt, installationId);

  // Cache in KV (1 hour TTL, but we check expiry above)
  if (env.AG_TOKENS_KV && token.token) {
    await env.AG_TOKENS_KV.put(
      cacheKey,
      JSON.stringify({ token: token.token, expiresAt: token.expiresAt.toISOString() }),
      { expirationTtl: 3600 },
    );
  }

  return token;
}

/** Fetch file contents from a repo via the GitHub API. */
async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
  const resp = await githubFetch(url, {
    headers: {
      Accept: "application/vnd.github.v3.raw",
      Authorization: `Bearer ${token}`,
      "User-Agent": "OpenCodeWEB/1.0",
    },
  });
  if (!resp.ok) return null;
  return resp.text();
}

/** Get the changed files from a push event (commit file list). */
async function getChangedFiles(
  token: string,
  owner: string,
  repo: string,
  payload: Record<string, unknown>,
): Promise<Array<{ path: string; content: string }>> {
  const commits = payload.commits as Array<{ id?: string; added?: string[]; modified?: string[] }> | undefined;
  if (!commits) return [];

  const files: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  const headCommit = commits[commits.length - 1];
  const ref = (payload.after as string) ?? headCommit?.id ?? "HEAD";

  for (const commit of commits) {
    const paths = [...(commit.added ?? []), ...(commit.modified ?? [])];
    for (const filePath of paths) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);

      // Only scan source files
      const ext = filePath.split(".").pop()?.toLowerCase();
      if (!ext || !["ts", "tsx", "js", "jsx", "rs", "go", "mjs", "cjs"].includes(ext)) continue;

      const content = await fetchFileContent(token, owner, repo, filePath, ref);
      if (content !== null) {
        files.push({ path: filePath, content });
      }
    }
  }

  return files;
}

/** Sync installation data to KV. */
async function syncInstallationToKv(
  kv: KVNamespace,
  installationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const installation = payload.installation as Record<string, unknown> | undefined;
  const account = (installation?.account ?? payload.sender) as
    Record<string, unknown> | undefined;
  const record: InstallRecord = {
    installationId,
    account: (account?.login as string) ?? "unknown",
    accountType: (account?.type as string) ?? "Unknown",
    setupAction: (payload.action as string) ?? "installed",
    installedAt: new Date().toISOString(),
    suspendedAt: null,
    updatedAt: new Date().toISOString(),
  };
  await kv.put(`ag_install:${installationId}`, JSON.stringify(record), {
    expirationTtl: 86400 * 90,
  });
}

/** Remove installation from KV (on uninstall). */
async function removeInstallationFromKv(
  kv: KVNamespace,
  installationId: string,
): Promise<void> {
  await kv.delete(`ag_install:${installationId}`);
  await kv.delete(`ag_token:${installationId}`);
}

/** Post a comment on an issue or PR. */
async function postComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  await githubFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "OpenCodeWEB/1.0",
    },
    body: JSON.stringify({ body }),
  });
}

/* ------------------------------------------------------------------ */
/*  Event handlers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Handle push events â€” the main processing pipeline.
 * 1. Create pre-mutation backup branch (off main, in the same repo)
 * 2. Scan changed files with AST inspector
 * 3. Apply auto-fixes
 * 4. Create fix branch + PR if fixes applied
 */
async function handlePush(
  env: Env,
  payload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<Response> {
  const repoFull = (payload.repository as Record<string, unknown> | undefined)?.full_name as string ?? "unknown";
  const [owner, repo] = repoFull.split("/");
  const ref = (payload.ref as string) ?? "unknown";
  const sender = (payload.sender as Record<string, unknown> | undefined)?.login as string ?? "unknown";
  const installationId = getInstallationId(payload, env);

  if (!installationId || !owner || !repo) {
    console.log(`[push] missing installation/owner/repo: ${repoFull} ref=${ref} sender=${sender}`);
    return json({ ok: true, event: "push", repo: repoFull, ref, warning: "missing context" });
  }

  console.log(`[push] ${sender} pushed to ${repoFull} ${ref} (inst=${installationId})`);

  // Respond immediately; process in background
  ctx.waitUntil(
    (async () => {
      try {
        // 0. Record commit telemetry (never fatal)
        await recordMetricsEvent(env, "commit", sender);
        console.log(`[metrics] commit recorded for ${sender}`);

        // 1. Get installation access token
        const token = await getAccessToken(env, installationId);

        // 2. Create pre-mutation backup
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        let backup: BackupResult | null = null;
        try {
          backup = await createBackup(token.token, owner, repo, timestamp);
          console.log(`[push] backup created: ${backup.type} ${backup.name}`);
          await recordMetricsEvent(env, "backup", sender);
          console.log(`[metrics] backup recorded for ${sender}`);
        } catch (err) {
          console.error(`[push] backup failed: ${err}`);
        }

        // 3. Scan changed files
        const changedFiles = await getChangedFiles(token.token, owner, repo, payload);
        if (changedFiles.length === 0) {
          console.log(`[push] no scannable files changed`);
          return;
        }

        const scanResult: ScanResult = scanFiles(changedFiles);
        console.log(
          `[push] scan: ${scanResult.summary.filesScanned} files, ` +
          `${scanResult.summary.errors} errors, ${scanResult.summary.warnings} warnings`,
        );

        // 4. Apply auto-fixes where possible
        const allFixes: FixResult[] = [];
        const fixedContents: Array<{ path: string; content: string }> = [];

        for (const file of changedFiles) {
          const { fixedContent, fixes } = applyAutoFixes(file.path, file.content, scanResult.issues);
          if (fixes.length > 0) {
            allFixes.push(...fixes);
            fixedContents.push({ path: file.path, content: fixedContent });
          }
        }

        // 5. If fixes applied, create fix branch + PR
        if (fixedContents.length > 0) {
          const fixBranch = createFixBranchName(timestamp);
          const commitMsg = buildCommitMessage(allFixes, fixBranch);

          try {
            // Create branch from the latest commit
            const after = payload.after as string;
            await createBranch(token.token, owner, repo, fixBranch, after);

            // Update each fixed file
            for (const fc of fixedContents) {
              await updateFileContent(token.token, owner, repo, fc.path, fc.content, commitMsg, fixBranch);
            }

            // Open PR
            const prUrl = await createPullRequest(
              token.token, owner, repo, fixBranch, ref.replace("refs/heads/", ""),
              `robot: OpenCodeWEB auto-repair [skip ci]`,
              `ðŸ¤– **OpenCodeWEB Auto-Repair Report**\n\n${allFixes.map(f =>
                `- âœ… ${f.fixApplied}`).join("\n")}\n\n---\n\n_Auto-generated by OpenCodeWEB_`,
            );
            console.log(`[push] PR created: ${prUrl}`);
            await recordMetricsEvent(env, "bug_fix", sender);
            console.log(`[metrics] bug_fix recorded for ${sender}`);
          } catch (err) {
            console.error(`[push] fix branch/PR failed: ${err}`);
          }
        } else if (scanResult.issues.length > 0) {
          // Issues found but not auto-fixable â€” log only (future: create issues)
          console.log(`[push] ${scanResult.issues.length} non-fixable issues found`);
        }
      } catch (err) {
        console.error(`[push] background processing failed: ${err}`);
      }
    })(),
  );

  return json({ ok: true, event: "push", repo: repoFull, ref });
}

/**
 * Handle pull_request events â€” post a review comment with scan results.
 */
async function handlePullRequest(
  env: Env,
  payload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<Response> {
  const action = (payload.action as string) ?? "unknown";
  const pr = (payload.pull_request as Record<string, unknown> | undefined)?.number as number ?? 0;
  const repoFull = (payload.repository as Record<string, unknown> | undefined)?.full_name as string ?? "unknown";
  const [owner, repo] = repoFull.split("/");
  const installationId = getInstallationId(payload, env);

  console.log(`[pull_request] ${action} PR #${pr} on ${repoFull}`);

  // Only comment on opened/synchronize
  if (action !== "opened" && action !== "synchronize") {
    return json({ ok: true, event: "pull_request", action, pr });
  }

  if (!installationId || !owner || !repo || !pr) {
    return json({ ok: true, event: "pull_request", action, pr, warning: "missing context" });
  }

  ctx.waitUntil(
    (async () => {
      try {
        const token = await getAccessToken(env, installationId);

        // Get changed files from the PR
        const changedFiles = await getPrChangedFiles(token.token, owner, repo, pr);
        if (changedFiles.length === 0) {
          console.log(`[pull_request] no scannable files in PR #${pr}`);
          return;
        }

        const scanResult = scanFiles(changedFiles);

        // Post a comment with scan summary
        let comment = `## ðŸ¤– OpenCodeWEB Code Review\n\n`;
        comment += `**Files scanned:** ${scanResult.summary.filesScanned}\n`;
        comment += `**Errors:** ${scanResult.summary.errors}\n`;
        comment += `**Warnings:** ${scanResult.summary.warnings}\n`;
        comment += `**Info:** ${scanResult.summary.infos}\n\n`;

        if (scanResult.issues.length > 0) {
          comment += `### Issues Found\n\n`;
          for (const issue of scanResult.issues.slice(0, 20)) {
            const icon = issue.severity === "error" ? "ðŸ”´" : issue.severity === "warning" ? "ðŸŸ¡" : "ðŸ”µ";
            comment += `- ${icon} \`${issue.file}:${issue.line}\` â€” ${issue.message}\n`;
          }
          if (scanResult.issues.length > 20) {
            comment += `\n_...and ${scanResult.issues.length - 20} more issues._\n`;
          }
        } else {
          comment += `âœ… **No issues found.**\n`;
        }

        await postComment(token.token, owner, repo, pr, comment);
        console.log(`[pull_request] comment posted on PR #${pr}`);
      } catch (err) {
        console.error(`[pull_request] background processing failed: ${err}`);
      }
    })(),
  );

  return json({ ok: true, event: "pull_request", action, pr });
}

/**
 * Handle installation events â€” sync KV when app is installed or uninstalled.
 */
async function handleInstallation(
  env: Env,
  payload: Record<string, unknown>,
): Promise<Response> {
  const action = (payload.action as string) ?? "unknown";
  const installationId = payload.installation
    ? String((payload.installation as Record<string, unknown>).id)
    : null;

  console.log(`[installation] ${action} id=${installationId}`);

  if (!installationId || !env.AG_TOKENS_KV) {
    return json({ ok: true, event: "installation", action, warning: "no KV or installationId" });
  }

  if (action === "deleted") {
    await removeInstallationFromKv(env.AG_TOKENS_KV, installationId);
    console.log(`[installation] removed ${installationId} from KV`);
  } else if (action === "created" || action === "added" || action === "suspend" || action === "unsuspend") {
    await syncInstallationToKv(env.AG_TOKENS_KV, installationId, payload);
    console.log(`[installation] synced ${installationId} to KV`);
  }

  return json({ ok: true, event: "installation", action });
}

/**
 * Handle installation_repositories events.
 */
async function handleInstallationRepos(
  env: Env,
  payload: Record<string, unknown>,
): Promise<Response> {
  const action = (payload.action as string) ?? "unknown";
  const installationId = payload.installation
    ? String((payload.installation as Record<string, unknown>).id)
    : null;

  console.log(`[installation_repositories] ${action} id=${installationId}`);
  return json({ ok: true, event: "installation_repositories", action });
}

/**
 * Handle issue_comment events.
 */
async function handleIssueComment(
  env: Env,
  payload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<Response> {
  const action = (payload.action as string) ?? "unknown";
  const issue = (payload.issue as Record<string, unknown> | undefined)?.number as number ?? 0;
  const repoFull = (payload.repository as Record<string, unknown> | undefined)?.full_name as string ?? "unknown";

  console.log(`[issue_comment] ${action} on issue #${issue} in ${repoFull}`);

  // Placeholder â€” future: respond to specific commands (e.g., "/scan")
  return json({ ok: true, event: "issue_comment", action, issue });
}

/**
 * Handle issues events.
 */
async function handleIssues(
  env: Env,
  payload: Record<string, unknown>,
): Promise<Response> {
  const action = (payload.action as string) ?? "unknown";
  const issue = (payload.issue as Record<string, unknown> | undefined)?.number as number ?? 0;
  const repoFull = (payload.repository as Record<string, unknown> | undefined)?.full_name as string ?? "unknown";

  console.log(`[issues] ${action} issue #${issue} in ${repoFull}`);
  return json({ ok: true, event: "issues", action, issue });
}

/* ------------------------------------------------------------------ */
/*  GitHub API helpers (for the push handler)                           */
/* ------------------------------------------------------------------ */

async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  sha: string,
): Promise<void> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/git/refs`;
  const resp = await githubFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "OpenCodeWEB/1.0",
    },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`createBranch failed: ${resp.status} ${body}`);
  }
}

async function updateFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  commitMessage: string,
  branch: string,
): Promise<void> {
  // Get current file SHA
  const getUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const getResp = await githubFetch(getUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "OpenCodeWEB/1.0",
      Accept: "application/vnd.github.v3+json",
    },
  });

  let sha: string | undefined;
  if (getResp.ok) {
    const data = (await getResp.json()) as { sha?: string };
    sha = data.sha;
  }

  // Create or update file
  const putUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const body: Record<string, unknown> = {
    message: commitMessage,
    content: btoa(content),
    branch,
  };
  if (sha) body.sha = sha;

  const putResp = await githubFetch(putUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "OpenCodeWEB/1.0",
    },
    body: JSON.stringify(body),
  });

  if (!putResp.ok) {
    const respBody = await putResp.text();
    throw new Error(`updateFileContent failed for ${path}: ${putResp.status} ${respBody}`);
  }
}

async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<string> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls`;
  const resp = await githubFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "OpenCodeWEB/1.0",
    },
    body: JSON.stringify({ title, body, head, base }),
  });

  if (!resp.ok) {
    const respBody = await resp.text();
    throw new Error(`createPR failed: ${resp.status} ${respBody}`);
  }

  const data = (await resp.json()) as { html_url?: string };
  return data.html_url ?? `https://github.com/${owner}/${repo}/pull/${(data as { number?: number }).number}`;
}

async function getPrChangedFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Array<{ path: string; content: string }>> {
  // List PR files
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`;
  const resp = await githubFetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "OpenCodeWEB/1.0",
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!resp.ok) return [];

  const files = (await resp.json()) as Array<{ filename: string; contents_url?: string; status?: string }>;
  const result: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    const ext = file.filename.split(".").pop()?.toLowerCase();
    if (!ext || !["ts", "tsx", "js", "jsx", "rs", "go", "mjs", "cjs"].includes(ext)) continue;

    const content = await fetchFileContent(token, owner, repo, file.filename, `pull/${prNumber}/head`);
    if (content !== null) {
      result.push({ path: file.filename, content });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Signature verification                                             */
/* ------------------------------------------------------------------ */

async function verifySignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const algo = { name: "HMAC", hash: "SHA-256" };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    algo,
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare
  if (expected.length !== signatureHeader.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return result === 0;
}

/* ------------------------------------------------------------------ */
/*  Main webhook entry point                                          */
/* ------------------------------------------------------------------ */

export async function handleWebhook(
  env: Env,
  event: string,
  delivery: string,
  body: string,
  signature: string | null,
  ctx?: ExecutionContext,
): Promise<Response> {
  // 1. Verify signature
  if (!env.WEBHOOK_SECRET) {
    return new Response("Webhook secret not configured", { status: 500 });
  }
  const valid = await verifySignature(env.WEBHOOK_SECRET, body, signature);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

// 2. Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  console.log(`[webhook] event=${event} delivery=${delivery}`);

  // 2b. Tenant isolation — the app is public, so ANY user can install it and
  // their webhooks will arrive signed with the same app secret. Only process
  // events whose account is in ALLOWED_ACCOUNTS; silently ack everyone else.
  const repo = (payload.repository ?? {}) as Record<string, unknown>;
  const owner =
    ((repo.owner as Record<string, unknown> | undefined)?.login as string) ??
    ((repo.owner as Record<string, unknown> | undefined)?.name as string) ??
    null;
  const installationAccount = (
    (payload.installation as Record<string, unknown> | undefined)?.account as
      | Record<string, unknown>
      | undefined)?.login as string | undefined;
  const sender =
    (payload.sender as Record<string, unknown> | undefined)?.login as
      | string
      | undefined;
  const tenant = owner ?? installationAccount ?? sender ?? null;
  if (!isAccountAllowed(env, tenant)) {
    console.log(
      `[webhook] ignore event=${event} delivery=${delivery} from unauthorized tenant="${tenant}"`,
    );
    return json({
      ok: true,
      event,
      ignored: true,
      reason: "tenant-not-allowed",
    });
  }

  // 3. Dispatch — all handlers return 200 immediately
  switch (event) {
    case "push":
      return handlePush(env, payload, ctx ?? ({} as ExecutionContext));
    case "pull_request":
      return handlePullRequest(env, payload, ctx ?? ({} as ExecutionContext));
    case "installation":
      return handleInstallation(env, payload);
    case "installation_repositories":
      return handleInstallationRepos(env, payload);
    case "issues":
      return handleIssues(env, payload);
    case "issue_comment":
      return handleIssueComment(env, payload, ctx ?? ({} as ExecutionContext));
    default:
      console.log(`[ignore] unsupported event: ${event}`);
      return json({ ok: true, event, ignored: true });
  }
}
