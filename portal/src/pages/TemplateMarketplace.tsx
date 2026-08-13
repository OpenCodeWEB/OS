const TEMPLATES = [
  {
    id: "fullstack-ts",
    name: "Full-Stack TypeScript",
    description:
      "React + Node.js + PostgreSQL starter with auth, CRUD, and CI/CD.",
    tags: ["TypeScript", "React", "Node.js"],
    author: "ABsUP",
    downloads: 1240,
  },
  {
    id: "agent-workforce",
    name: "Multi-Agent Workforce",
    description:
      "Pre-configured 33+ agent role setup for enterprise orchestration.",
    tags: ["Agents", "Enterprise", "Orchestration"],
    author: "ABsUPs",
    downloads: 890,
  },
  {
    id: "serverless-edge",
    name: "Serverless Edge Worker",
    description: "Cloudflare Workers template with D1 database and KV storage.",
    tags: ["Cloudflare", "Edge", "Serverless"],
    author: "community",
    downloads: 2100,
  },
  {
    id: "mobile-termux",
    name: "Mobile Termux Daemon",
    description:
      "Android Termux background service with foreground notification.",
    tags: ["Android", "Termux", "Mobile"],
    author: "ABsUP",
    downloads: 560,
  },
  {
    id: "docker-vps",
    name: "Docker VPS Deploy",
    description:
      "Production-ready Docker setup with restart policies and health checks.",
    tags: ["Docker", "VPS", "DevOps"],
    author: "community",
    downloads: 1780,
  },
  {
    id: "ai-pipeline",
    name: "AI Parallel Pipeline",
    description:
      "Dual-stream verification and optimization pipeline with auto-merge.",
    tags: ["AI", "Pipeline", "CI/CD"],
    author: "ABsUPs",
    downloads: 670,
  },
] as const;

export default function TemplateMarketplace() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-12">
        <h1 className="text-3xl font-bold tracking-tight">
          Template <span className="text-brand-400">Marketplace</span>
        </h1>
        <p className="mt-3 text-white/40">
          Public repository for sharing multi-agent templates and OpenCode
          setups.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-8 flex flex-wrap gap-2">
        {[
          "All",
          "TypeScript",
          "Enterprise",
          "Serverless",
          "Mobile",
          "DevOps",
          "AI",
        ].map((filter) => (
          <button
            key={filter}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              filter === "All"
                ? "bg-brand-600 text-white"
                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((template) => (
          <div
            key={template.id}
            className="card-surface group cursor-pointer transition-all hover:border-brand-500/30"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">{template.name}</h3>
              <span className="text-xs text-white/30">
                {template.downloads} downloads
              </span>
            </div>
            <p className="mb-4 text-sm text-white/50">{template.description}</p>
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-1">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-white/5 px-2 py-0.5 text-xs text-white/40"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <span className="text-xs text-white/30">
                by {template.author}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
