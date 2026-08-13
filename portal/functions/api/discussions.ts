/**
 * GET /api/discussions — proxy to GitHub Discussions GraphQL API
 *
 * Fetches discussions from the OpenCodeWEB organization repositories.
 * Requires GITHUB_TOKEN env var (classic PAT with public_repo scope).
 *
 * Query params:
 *   ?first=20  — number of discussions to fetch (default 20, max 50)
 *   ?after=    — cursor for pagination
 */

interface Env {
  GITHUB_TOKEN?: string;
}

const OWNER = "OpenCodeWEB";
const REPO = "UI";

const DISCUSSIONS_QUERY = `
query($owner: String!, $repo: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    discussions(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        number
        title
        url
        createdAt
        category { name }
        author { login avatarUrl }
        answer { id }
        labels(first: 5) { nodes { name color } }
        comments { totalCount }
      }
    }
  }
}
`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return json({ error: "GitHub API token not configured" }, 503);
  }

  const url = new URL(request.url);
  const first = Math.min(Math.max(parseInt(url.searchParams.get("first") ?? "20") || 20, 1), 50);
  const after = url.searchParams.get("after") ?? undefined;

  try {
    const graphqlResp = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "OpenCodeABsUI-UX/1.0",
      },
      body: JSON.stringify({
        query: DISCUSSIONS_QUERY,
        variables: { owner: OWNER, repo: REPO, first, after },
      }),
    });

    // Handle non-200 responses from GitHub before parsing JSON
    if (!graphqlResp.ok) {
      const errBody = await graphqlResp.text().catch(() => "Unknown GitHub error");
      return json(
        {
          error: "GitHub API error",
          status: graphqlResp.status,
          details: errBody.slice(0, 200),
        },
        502,
      );
    }

    const result = (await graphqlResp.json()) as {
      data?: {
        repository?: {
          discussions?: {
            totalCount: number;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{
              id: string;
              number: number;
              title: string;
              url: string;
              createdAt: string;
              category: { name: string };
              author: { login: string; avatarUrl: string } | null;
              answer: { id: string } | null;
              labels: { nodes: Array<{ name: string; color: string }> };
              comments: { totalCount: number };
            }>;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    // Forward GraphQL errors
    if (result.errors || !result.data?.repository?.discussions) {
      return json(
        {
          error: "GitHub API error",
          details: result.errors?.[0]?.message ?? "Empty data from GitHub API",
        },
        502,
      );
    }

    const discussions_data = result.data.repository.discussions;

    // Map to a clean frontend-friendly format
    const discussions = discussions_data.nodes.map((node) => ({
      id: node.id,
      number: node.number,
      title: node.title,
      url: node.url,
      category: node.category.name,
      author: node.author?.login ?? "unknown",
      authorAvatar: node.author?.avatarUrl ?? "",
      replyCount: node.comments.totalCount,
      isAnswered: node.answer !== null,
      createdAt: node.createdAt,
      labels: node.labels.nodes.map((l) => ({ name: l.name, color: l.color })),
    }));

    return json({
      discussions,
      totalCount: discussions_data.totalCount,
      pageInfo: discussions_data.pageInfo,
    });
  } catch (err) {
    console.error("Discussions API error:", err);
    return json({ error: "Failed to fetch discussions" }, 500);
  }
};
