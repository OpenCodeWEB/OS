/**
 * Community Hubs API
 *
 * GET /api/community/hubs?sort=rank&tag=All&status=active
 *   — list all community hubs with smart ranking, sorting, and tag filtering
 * POST /api/community/hubs — register a new community hub (auth required)
 */

interface CommunityHub {
  id: string;
  owner: string;
  name: string;
  project?: string;
  description: string;
  starCount: number;
  forkCount: number;
  discussionCount: number;
  memberCount: number;
  lastActive: string;
  createdAt: string;
  /** Computed by the ranking algorithm */
  rank: number;
  /** Whether this is the immutable root hub (ABsUPs/CommunityHub) */
  isRoot: boolean;
  /** Thread tags present in this hub (Templates, Features, Showcase, Bug Reports) */
  tags: string[];
}

interface Env {
  DEVICES_KV?: KVNamespace;
  SESSIONS_KV?: KVNamespace;
}

type SortKey = "rank" | "members" | "stars" | "created";
type TagFilter = "All" | "Templates" | "Features" | "Showcase" | "Bug Reports";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── The immutable root hub — always rank #1 ────────────────
const ROOT_HUB: CommunityHub = {
  id: "absups-communityhub",
  owner: "ABsUPs",
  name: "CommunityHub",
  project: undefined,
  description: "The canonical root community hub. All user hubs fork from this repository. Discussions, templates, and community-driven development for the OpenCodeABsUI/UX ecosystem.",
  starCount: 0,
  forkCount: 0,
  discussionCount: 0,
  memberCount: 1,
  lastActive: new Date().toISOString(),
  createdAt: "2026-07-01T00:00:00.000Z",
  rank: 1,
  isRoot: true,
  tags: ["Templates", "Features", "Showcase", "Bug Reports"],
};

// ─── Seed hubs (discoverable when no KV exists) ────────────
const SEED_HUBS: CommunityHub[] = [
  {
    id: "absup-personal",
    owner: "ABsUP",
    name: "personal-hub",
    project: undefined,
    description: "Personal community hub of ABsUP — discussions about OpenCode plugin development, multi-agent orchestration, and infrastructure management.",
    starCount: 0,
    forkCount: 0,
    discussionCount: 12,
    memberCount: 1,
    lastActive: new Date().toISOString(),
    createdAt: "2026-07-10T00:00:00.000Z",
    rank: 2,
    isRoot: false,
    tags: ["Templates", "Features"],
  },
  {
    id: "girlsab-personal",
    owner: "GIRLsAB",
    name: "personal-hub",
    project: undefined,
    description: "Community hub for GIRLsAB — AI agent workflows, template sharing, and project showcases.",
    starCount: 0,
    forkCount: 0,
    discussionCount: 8,
    memberCount: 1,
    lastActive: new Date().toISOString(),
    createdAt: "2026-07-15T00:00:00.000Z",
    rank: 3,
    isRoot: false,
    tags: ["Templates", "Showcase"],
  },
  {
    id: "absup-opencodewebsui",
    owner: "ABsUP",
    name: "OpenCodeWEBsUI",
    project: "OpenCodeWEBsUI",
    description: "Project hub for the OpenCodeWEBsUI repository. Feature discussions, bug reports, and community contributions for the main UI framework.",
    starCount: 0,
    forkCount: 0,
    discussionCount: 5,
    memberCount: 2,
    lastActive: new Date().toISOString(),
    createdAt: "2026-07-20T00:00:00.000Z",
    rank: 4,
    isRoot: false,
    tags: ["Features", "Bug Reports"],
  },
];

async function getUser(request: Request, kv: KVNamespace): Promise<string | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  if (!token) return null;
  const session = await kv.get(`session:${token}`);
  if (!session) return null;
  return (JSON.parse(session).user?.login as string) ?? null;
}

// ─── Sorting comparator factories ──────────────────────────
function sortByRank(a: CommunityHub, b: CommunityHub): number {
  return a.rank - b.rank;
}

function sortByMembers(a: CommunityHub, b: CommunityHub): number {
  // Root hub always stays #1
  if (a.isRoot) return -1;
  if (b.isRoot) return 1;
  return b.memberCount - a.memberCount;
}

function sortByStars(a: CommunityHub, b: CommunityHub): number {
  if (a.isRoot) return -1;
  if (b.isRoot) return 1;
  const aCombined = a.starCount + a.forkCount;
  const bCombined = b.starCount + b.forkCount;
  return bCombined - aCombined;
}

function sortByCreated(a: CommunityHub, b: CommunityHub): number {
  if (a.isRoot) return -1;
  if (b.isRoot) return 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

const SORTERS: Record<SortKey, (a: CommunityHub, b: CommunityHub) => number> = {
  rank: sortByRank,
  members: sortByMembers,
  stars: sortByStars,
  created: sortByCreated,
};

// ─── Tag filter ────────────────────────────────────────────
function filterByTag(hub: CommunityHub, tag: TagFilter): boolean {
  if (tag === "All") return true;
  return hub.tags.includes(tag);
}

// ─── GET /api/community/hubs ────────────────────────────────
export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const kv = env.DEVICES_KV;

  // Parse query params
  const url = new URL(request.url);
  const sortParam = (url.searchParams.get("sort") ?? "rank") as SortKey;
  const tagParam = (url.searchParams.get("tag") ?? "All") as TagFilter;

  // Validate params
  const sortKey: SortKey = sortParam in SORTERS ? sortParam : "rank";
  const tagKey: TagFilter = ["All", "Templates", "Features", "Showcase", "Bug Reports"].includes(tagParam)
    ? tagParam
    : "All";

  // Gather all hubs
  const allHubs: CommunityHub[] = [ROOT_HUB, ...SEED_HUBS];

  // Merge user-registered hubs from KV
  if (kv) {
    try {
      const list = await kv.list({ prefix: "community-hub:" });
      for (const key of list.keys) {
        const val = await kv.get(key.name);
        if (val) {
          const hub = JSON.parse(val) as CommunityHub;
          if (!allHubs.some((h) => h.id === hub.id)) {
            allHubs.push(hub);
          }
        }
      }
    } catch {
      // KV not available
    }
  }

  // Apply tag filter
  const filtered = allHubs.filter((h) => filterByTag(h, tagKey));

  // Apply sort
  filtered.sort(SORTERS[sortKey]);

  return json({ hubs: filtered, sort: sortKey, tag: tagKey });
};

// ─── POST /api/community/hubs — register a new hub ─────────
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const kv = env.DEVICES_KV;

  if (!kv || !env.SESSIONS_KV) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, env.SESSIONS_KV);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as Partial<CommunityHub>;
  if (!body.name) {
    return json({ error: "name is required" }, 400);
  }

  const hub: CommunityHub = {
    id: `hub-${crypto.randomUUID().slice(0, 8)}`,
    owner: user,
    name: body.name,
    project: body.project,
    description: body.description ?? "",
    starCount: 0,
    forkCount: 0,
    discussionCount: 0,
    memberCount: 1,
    lastActive: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    rank: 999, // New hubs go to the bottom initially
    isRoot: false,
    tags: body.tags ?? [],
  };

  await kv.put(`community-hub:${hub.id}`, JSON.stringify(hub), {
    expirationTtl: 86400 * 90,
  });

  return json({ hub }, 201);
};
