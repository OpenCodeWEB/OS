import { useParams } from "react-router-dom";

const DEVICE_STATUS = [
  { name: "MacBook Pro", os: "macOS", status: "online" as const },
  { name: "Workstation PC", os: "Windows", status: "online" as const },
  { name: "Mobile Termux", os: "Android", status: "offline" as const },
] as const;

export default function UserProfile() {
  const { username } = useParams<{ username: string }>();

  if (!username) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-white/40">No username provided.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      {/* Profile header */}
      <div className="mb-12 flex flex-col items-center gap-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-600/20 text-3xl font-bold text-brand-400">
          {username.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{username}</h1>
          <p className="mt-2 text-white/40">Device Admin & Control Dashboard</p>
        </div>
      </div>

      {/* Device selector */}
      <section className="mb-12">
        <h2 className="mb-6 text-xl font-semibold">Active Devices</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {DEVICE_STATUS.map((device) => (
            <div
              key={device.name}
              className="card-surface flex items-center gap-4"
            >
              <div
                className={`h-3 w-3 rounded-full ${
                  device.status === "online"
                    ? "bg-emerald-400 animate-pulse-glow"
                    : "bg-white/20"
                }`}
              />
              <div>
                <div className="font-medium">{device.name}</div>
                <div className="text-sm text-white/40">{device.os}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Offline snapshot notice */}
      <section className="card-surface border-amber-500/20">
        <h3 className="text-lg font-semibold text-amber-400">
          Offline Snapshot Mode
        </h3>
        <p className="mt-2 text-sm text-white/50">
          When all devices are offline, this dashboard renders a read-only view
          from your private GitHub fork state-backup branch. No server costs,
          zero downtime.
        </p>
      </section>
    </div>
  );
}
