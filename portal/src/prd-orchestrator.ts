/**
 * PRD Orchestrator — Environment-Aware PRD Path Specification
 *
 * Strict Local PRD Storage & Isolation Manager (Public User Runtime Mode).
 *
 * ── Architecture ──
 *
 *   Master Document:  PRD.md  (single source of truth for all system modules)
 *   Subject Indexes:  ToDo.md, Logic.md, Design.md, Community_Hub.md,
 *                     Security_Integrity.md  (lightweight TOCs → PRD.md sections)
 *
 *   [routeAndWrite()] writes content as sections within PRD.md.
 *   Subject files are auto-derived indexes — never written to directly.
 *
 * ── 6‑Step Startup Pipeline ──
 *
 *   [1. Path Resolution Engine]     → cross-platform project root detection
 *   [2. Folder Verification]         → auto-create OpenCodeWEBsPRD/
 *   [3. Privacy Guardrail]           → .gitignore enforcement
 *   [4. Auto-Sweep & Migration]      → relocate loose PRD files
 *   [5. Subject Router]              → route content into PRD.md sections
 *   [6. Isolated Write]              → enforce strict local-only storage
 *
 * ── Core Principles ──
 * 1. CRITICAL: Never upload, push, or sync PRD files to any cloud endpoint.
 * 2. PRD.md is the single source of truth. Subject files are derived indexes.
 * 3. Cross-platform (Windows, macOS, Linux, Termux) path resolution.
 * 4. Fully idempotent — safe to call initialise() multiple times.
 */

// Node.js built-ins — available in OpenCode plugin runtime (not browser)
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Canonical folder name for PRD storage — same on all platforms. */
const PRD_FOLDER = "OpenCodeWEBsPRD";

/** Master PRD filename — single source of truth. */
const MASTER_PRD = "PRD.md";

/** Ordered subject index files (lightweight TOCs pointing into PRD.md). */
const SUBJECT_INDEXES = [
  "ToDo.md",
  "Logic.md",
  "Design.md",
  "Community_Hub.md",
  "Security_Integrity.md",
] as const;

export type SubjectModule = (typeof SUBJECT_INDEXES)[number];

/** Globs/entries to add to .gitignore for strict local isolation. */
const GITIGNORE_ENTRIES = [
  "",
  "# ── Local PRD Isolation (managed by prd-orchestrator) ──",
  "# All PRD documents are strictly local. Never push to GitHub or sync to cloud.",
  `${PRD_FOLDER}/`,
  `**/${PRD_FOLDER}/`,
  `**/PRD*.md`,
  "",
];

/** Marker string used to detect our block in .gitignore. */
const GITIGNORE_MARKER =
  "# ── Local PRD Isolation (managed by prd-orchestrator) ──";

/* ------------------------------------------------------------------ */
/*  Step 1 — Path Resolution Engine (cross-platform)                   */
/* ------------------------------------------------------------------ */

/**
 * Resolves the project root directory across all supported platforms.
 *
 * Strategy (in priority order):
 *  1. If `process.env.INIT_CWD` is set (npm/yarn lifecycle), use it.
 *  2. Use `process.cwd()` — reliable in most runtimes.
 *  3. Fallback: `__dirname` walked up to a known project marker (`package.json`,
 *     `.git`, or `conductor/`).
 *
 * Returns the absolute path to the project root (no trailing slash).
 */
export function resolveProjectRoot(): string {
  // 1. Prefer explicit env override (useful for CI or plugin lifecycles)
  if (process.env.PRD_PROJECT_ROOT) {
    return path.resolve(process.env.PRD_PROJECT_ROOT);
  }

  // 2. INIT_CWD from npm/yarn lifecycle
  if (process.env.INIT_CWD) {
    return path.resolve(process.env.INIT_CWD);
  }

  // 3. current working directory (most common)
  const cwd = process.cwd();

  // 4. Walk up from __dirname to find project root marker
  //    (handles cases where the plugin is deep inside node_modules)
  const markers = ["package.json", ".git", "conductor"];
  let dir = __dirname;
  let depth = 0;
  while (depth < 10) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
    depth++;
  }

  // 5. final fallback
  return cwd;
}

/** Cache for resolved path to avoid repeated filesystem walks. */
let _resolvedRoot: string | null = null;

/**
 * Resolves and caches the project root.
 */
export function getProjectRoot(): string {
  if (!_resolvedRoot) {
    _resolvedRoot = resolveProjectRoot();
  }
  return _resolvedRoot;
}

/**
 * Returns the canonical PRD storage path: `<ProjectRoot>/OpenCodeWEBsPRD/`
 */
export function getPRDDirectory(): string {
  return path.join(getProjectRoot(), PRD_FOLDER);
}

/**
 * Returns the full path for a given filename inside the PRD directory.
 * Example: getPRDPath("ToDo.md") → "D:\Project\OpenCodeWEBsPRD\ToDo.md"
 */
export function getPRDPath(filename: string): string {
  return path.join(getPRDDirectory(), path.basename(filename));
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Folder Verification & Creation                            */
/* ------------------------------------------------------------------ */

/**
 * Ensures `OpenCodeWEBsPRD/` exists under the project root.
 * Creates it recursively if missing.
 * Returns `true` if the directory was created, `false` if it already existed.
 */
export function ensurePRDDirectory(): boolean {
  const dir = getPRDDirectory();
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  console.log(`[prd-orchestrator] ✅ Created PRD directory: ${dir}`);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Step 3 — Privacy Guardrail (.gitignore)                            */
/* ------------------------------------------------------------------ */

/**
 * Checks and updates `.gitignore` to exclude `OpenCodeWEBsPRD/` from version control.
 *
 * - If `.gitignore` does not exist, creates it with our entries.
 * - If it exists but lacks our marker block, appends it.
 * - If it already contains our marker, skips (idempotent).
 *
 * Returns `true` if `.gitignore` was modified, `false` if already isolated.
 */
export function ensureGitignoreIsolation(): boolean {
  const gitignorePath = path.join(getProjectRoot(), ".gitignore");
  let content = "";

  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, "utf-8");
  }

  // Already has our block — no action needed
  if (content.includes(GITIGNORE_MARKER)) {
    return false;
  }

  // Append our isolation block
  const newBlock = GITIGNORE_ENTRIES.join(os.EOL);
  const separator =
    content.endsWith("\n") || content.length === 0 ? "" : os.EOL;
  content += separator + newBlock + os.EOL;

  fs.writeFileSync(gitignorePath, content, "utf-8");
  console.log(`[prd-orchestrator] 🔒 Updated .gitignore: ${gitignorePath}`);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Step 4 — Auto-Sweep & Migration Engine                             */
/* ------------------------------------------------------------------ */

/**
 * Scans the project root for loose markdown files whose names match
 * known PRD patterns and migrates them into `OpenCodeWEBsPRD/`.
 *
 * Matches:
 *  - `PRD*.md` (case-insensitive)
 *  - Any file matching a known subject module name (ToDo.md, Logic.md, etc.)
 *  - General `*.md` files that look like PRD documents (heuristic)
 *
 * Skips files already inside the PRD directory to avoid loops.
 *
 * Returns a list of relocation results.
 */
export function sweepAndRelocate(): Array<{
  from: string;
  to: string;
  status: "moved" | "skipped" | "error";
  error?: string;
}> {
  const results: Array<{
    from: string;
    to: string;
    status: "moved" | "skipped" | "error";
    error?: string;
  }> = [];

  const root = getProjectRoot();
  const prdDir = getPRDDirectory();

  // Only scan the project root; don't recurse into subdirectories
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return results;
  }

  // Patterns for identifying PRD-related markdown files
  const knownSubjects = new Set<string>(SUBJECT_INDEXES);
  const prdPattern = /^PRD.*\.md$/i;

  for (const entry of entries) {
    // Must be a .md file
    if (!entry.endsWith(".md")) continue;

    const src = path.join(root, entry);

    // Skip if already inside the PRD directory
    if (path.dirname(path.resolve(src)) === prdDir) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(src);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    // Match: PRD-prefixed, known subject names, universal-engine, or heuristic PRD content
    const isPRDFile =
      prdPattern.test(entry) ||
      knownSubjects.has(entry as SubjectModule) ||
      entry === "universal-engine.md" ||
      /(?:PRD|requirement|spec|roadmap|architecture|design|security|integrity|universal)/i.test(
        entry,
      );

    if (!isPRDFile) continue;

    const dest = path.join(prdDir, entry);

    // If destination already exists, back it up with a timestamp
    try {
      if (fs.existsSync(dest)) {
        const ext = path.extname(entry);
        const base = path.basename(entry, ext);
        const backup = path.join(prdDir, `${base}.${Date.now()}${ext}`);
        fs.renameSync(dest, backup);
        console.log(
          `[prd-orchestrator] 📦 Backed up existing: ${dest} → ${backup}`,
        );
      }

      fs.renameSync(src, dest);
      console.log(`[prd-orchestrator] 📦 Relocated: ${src} → ${dest}`);
      results.push({ from: src, to: dest, status: "moved" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[prd-orchestrator] ❌ Failed to relocate ${src}: ${msg}`);
      results.push({ from: src, to: dest, status: "error", error: msg });
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Section Heading Helpers                                            */
/* ------------------------------------------------------------------ */

/** Maps subject categories to their section numbers in PRD.md. */
const SECTION_MAP: Record<string, { number: string; title: string }> = {
  todo: { number: "8", title: "Roadmap & Acceptance Criteria" },
  logic: { number: "4", title: "System Modules" },
  design: { number: "5", title: "Design System" },
  community: { number: "4.7", title: "Community Hub Module" },
  security: { number: "7", title: "Security & Privacy Guardrails" },
};

/**
 * Subject categories that the router can write to.
 */
export type SubjectCategory = keyof typeof SECTION_MAP;

/* ------------------------------------------------------------------ */
/*  Step 5 — Subject Router (writes to PRD.md)                         */
/* ------------------------------------------------------------------ */

/**
 * Routes content into the master PRD.md file under the appropriate section.
 *
 * The router:
 *  1. Ensures the PRD directory and PRD.md exist.
 *  2. Appends or inserts content under the section heading for the category.
 *  3. Returns the path to PRD.md.
 *
 * @param category  The subject category for section routing.
 * @param content   The markdown content to write.
 * @param mode      "append" (default) — adds content under the section.
 *                  "overwrite" — replaces the entire PRD.md (use with care).
 */
export function routeAndWrite(
  category: SubjectCategory,
  content: string,
  mode: "append" | "overwrite" = "append",
): string {
  const filepath = getPRDPath(MASTER_PRD);
  ensurePRDDirectory();

  const section = SECTION_MAP[category];
  const heading = `### ${section.number} — ${section.title}`;

  if (mode === "overwrite") {
    fs.writeFileSync(filepath, content, "utf-8");
    console.log(`[prd-orchestrator] 📝 PRD.md overwritten (${category})`);
    return filepath;
  }

  // Append mode: add content under the section heading
  let existing = fs.existsSync(filepath)
    ? fs.readFileSync(filepath, "utf-8")
    : "";

  // If PRD.md doesn't exist yet, create it with a title
  if (!existing.trim()) {
    existing = `# Product Requirement Document (PRD) — OpenCodeABsUI/UX\n\n`;
  }

  const block = `\n\n${heading}\n\n${content.trim()}\n`;
  fs.writeFileSync(filepath, existing + block, "utf-8");

  console.log(
    `[prd-orchestrator] 📝 Appended to PRD.md under "${heading}" (${category})`,
  );
  return filepath;
}

/**
 * Reads the master PRD.md file.
 * Returns `null` if it does not exist.
 */
export function readPRD(): string | null {
  const filepath = getPRDPath(MASTER_PRD);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

/**
 * Extracts a section from PRD.md based on subject category.
 * Returns the raw text of the section, or `null` if not found.
 */
export function readSubject(category: SubjectCategory): string | null {
  const full = readPRD();
  if (!full) return null;

  const section = SECTION_MAP[category];
  const marker = `### ${section.number} — ${section.title}`;

  const startIdx = full.indexOf(marker);
  if (startIdx === -1) return null;

  // Find the next heading at the same or higher level
  const rest = full.slice(startIdx + marker.length);
  const nextHeading = rest.search(/\n#{1,3}\s/);
  const sectionContent = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return `${marker}${sectionContent}`.trim();
}

/**
 * Convenience: writes content to an arbitrary filename inside OpenCodeWEBsPRD/.
 * Bypasses the subject router for ad-hoc files.
 */
export function writePRD(filename: string, content: string): string {
  const filepath = getPRDPath(filename);
  ensurePRDDirectory();
  fs.writeFileSync(filepath, content, "utf-8");
  console.log(`[prd-orchestrator] 📝 Written: ${filepath}`);
  return filepath;
}

/**
 * Lists all files currently stored in the OpenCodeWEBsPRD/ directory.
 */
export function listPRDs(): string[] {
  const dir = getPRDDirectory();
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((f: string) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

/**
 * Regenerates subject index files (ToDo.md, Logic.md, etc.) as lightweight
 * TOCs that point to the corresponding sections in PRD.md.
 *
 * Call this after making structural changes to PRD.md.
 */
export function syncSubjectIndexes(): void {
  const prdPath = getPRDPath(MASTER_PRD);
  if (!fs.existsSync(prdPath)) return;

  const indexes: Record<string, string> = {
    "ToDo.md": `# ToDo.md → Roadmap & Execution\n\nSee [PRD.md §8 — Roadmap & Acceptance Criteria](./PRD.md#8-roadmap--acceptance-criteria).\n`,
    "Logic.md": `# Logic.md → Backend Logic & Routing\n\nSee [PRD.md §§3–6](./PRD.md#3-route-map) for all logic-related sections.\n`,
    "Design.md": `# Design.md → UI/UX & Design System\n\nSee [PRD.md §5 — Design System](./PRD.md#5-design-system).\n`,
    "Community_Hub.md": `# Community_Hub.md → Community Module\n\nSee [PRD.md §4.7 — Community Hub Module](./PRD.md#47-community-hub-module-c).\n`,
    "Security_Integrity.md": `# Security_Integrity.md → Security & Privacy\n\nSee [PRD.md §4.1, §4.2, §7](./PRD.md#7-security--privacy-guardrails).\n`,
    "universal-engine.md": `# universal-engine.md → Universal Coding Engine Spec\n\nFull specification for the Universal Coding Language Support Engine.\nSee [PRD.md §4.10](./PRD.md#410-universal-coding-language-support-engine-universal-enginets) and §7.\n`,
  };

  const dir = getPRDDirectory();
  for (const [filename, content] of Object.entries(indexes)) {
    fs.writeFileSync(path.join(dir, filename), content, "utf-8");
  }

  console.log(
    `[prd-orchestrator] 🔄 Synced ${Object.keys(indexes).length} subject index files → PRD.md`,
  );
}

/* ------------------------------------------------------------------ */
/*  Step 6 — Full Startup Initialisation                               */
/* ------------------------------------------------------------------ */

/**
 * Results from the full orchestrator startup sequence.
 */
export interface OrchestratorInitResult {
  /** The resolved project root path. */
  projectRoot: string;
  /** The canonical PRD directory path. */
  prdDirectory: string;
  /** Was the PRD directory created fresh? */
  directoryCreated: boolean;
  /** Files that were relocated during auto-sweep. */
  relocated: Array<{
    from: string;
    to: string;
    status: string;
    error?: string;
  }>;
  /** Was .gitignore updated? */
  gitignoreUpdated: boolean;
  /** Files present in the PRD directory after init. */
  prdFiles: string[];
}

/**
 * Runs the complete 6‑step PRD orchestration startup pipeline:
 *
 *   1. Path Resolution Engine
 *   2. Folder Verification & Creation
 *   3. Privacy Guardrail (.gitignore)
 *   4. Auto-Sweep & Migration Engine
 *   5. Subject-Based Modular PRD Router (ready)
 *   6. Isolation Enforcement (reports current state)
 *
 * Call this once on plugin/module initialisation.
 * Safe to call multiple times (idempotent).
 */
export function initialisePRDOrchestrator(): OrchestratorInitResult {
  console.log("[prd-orchestrator] 🔌 Initialising PRD Orchestrator…");

  // Step 1 — Path Resolution
  const projectRoot = getProjectRoot();
  const prdDirectory = getPRDDirectory();
  console.log(`[prd-orchestrator]   Step 1 ✓  Project Root: ${projectRoot}`);
  console.log(`[prd-orchestrator]   Step 1 ✓  PRD Directory: ${prdDirectory}`);

  // Step 2 — Folder Verification & Creation
  const directoryCreated = ensurePRDDirectory();
  console.log(
    `[prd-orchestrator]   Step 2 ✓  Directory ${directoryCreated ? "created" : "exists"}`,
  );

  // Step 3 — Privacy Guardrail (.gitignore)
  const gitignoreUpdated = ensureGitignoreIsolation();
  console.log(
    `[prd-orchestrator]   Step 3 ✓  .gitignore ${gitignoreUpdated ? "updated" : "already isolated"}`,
  );

  // Step 4 — Auto-Sweep & Migration
  const relocated = sweepAndRelocate();
  const movedCount = relocated.filter((r) => r.status === "moved").length;
  console.log(`[prd-orchestrator]   Step 4 ✓  ${movedCount} file(s) relocated`);

  // Step 5 — Subject Router writes to PRD.md sections
  // Step 6 — Sync subject indexes and report
  syncSubjectIndexes();
  const prdFiles = listPRDs();
  console.log(
    `[prd-orchestrator]   Step 5–6 ✓  ${prdFiles.length} file(s) in store (master: PRD.md)`,
  );
  console.log(`[prd-orchestrator] ✅ Initialisation complete.`);

  return {
    projectRoot,
    prdDirectory,
    directoryCreated,
    relocated,
    gitignoreUpdated,
    prdFiles,
  };
}

/* ------------------------------------------------------------------ */
/*  Diagnostic / Utility                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns the current environment information for debugging.
 */
export function getEnvironmentInfo(): {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  projectRoot: string;
  prdDirectory: string;
  isTermux: boolean;
} {
  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    projectRoot: getProjectRoot(),
    prdDirectory: getPRDDirectory(),
    isTermux:
      process.env.TERMUX_VERSION !== undefined ||
      process.env.PREFIX === "/data/data/com.termux/files/usr",
  };
}
