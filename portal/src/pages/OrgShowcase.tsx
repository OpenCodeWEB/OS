import { useParams } from "react-router-dom";

const AGENT_ROLES = [
  "Project Manager",
  "Lead Engineer",
  "Security Analyst",
  "QA Engineer",
  "DevOps Specialist",
  "Frontend Architect",
  "Backend Engineer",
  "Data Scientist",
] as const;

export default function OrgShowcase() {
  const { org, company } = useParams<{ org: string; company: string }>();

  if (!org || !company) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-white/40">Invalid organization path.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      {/* Brand header */}
      <div className="mb-16 flex flex-col items-center gap-6 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-brand-600/20 text-4xl font-bold text-brand-400">
          {company.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{company}</h1>
            <span className="badge">Verified</span>
          </div>
          <p className="mt-2 text-sm text-white/30">
            /{org}/{company}
          </p>
        </div>
        <p className="max-w-xl text-white/50">
          Organization showcase with AI workforce metrics, live token
          throughput, and public project cards. Managed under the{" "}
          <span className="text-brand-300">{org}</span> namespace.
        </p>
      </div>

      {/* Workforce metrics */}
      <section className="mb-12">
        <h2 className="mb-6 text-xl font-semibold">AI Workforce</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGENT_ROLES.map((role) => (
            <div
              key={role}
              className="card-surface flex items-center justify-between"
            >
              <span className="text-sm font-medium">{role}</span>
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
            </div>
          ))}
        </div>
      </section>

      {/* Resource gauges */}
      <section className="mb-12 grid gap-4 md:grid-cols-2">
        <div className="card-surface">
          <div className="text-sm text-white/40">Token Throughput</div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/5">
            <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-brand-600 to-brand-400" />
          </div>
          <div className="mt-2 text-xs text-white/30">75% capacity</div>
        </div>
        <div className="card-surface">
          <div className="text-sm text-white/40">Sandbox Storage</div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/5">
            <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400" />
          </div>
          <div className="mt-2 text-xs text-white/30">50% used</div>
        </div>
      </section>
    </div>
  );
}
