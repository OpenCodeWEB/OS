import { useEffect, useState } from "react";
import MultiplayerGlobe from "../components/MultiplayerGlobe";

const STATS = [
  { label: "Active Nodes", value: "2,847" },
  { label: "Sandbox Deployments", value: "12,543" },
  { label: "Templates Shared", value: "891" },
  { label: "Community Members", value: "5,200+" },
] as const;

export default function Home() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative overflow-hidden">
      {/* Hero section */}
      <section className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-20 md:px-6 md:py-24">
        {/* Ambient gradient */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600/8 blur-[100px] md:h-[500px] md:w-[500px]" />
        </div>

        <div
          className={`relative z-10 flex flex-col items-center gap-8 transition-all duration-1000 md:gap-10 ${
            isLoaded ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          <div className="text-center">
            <div className="mb-3">
              <span className="badge">v1.0.0-EA</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight md:text-5xl lg:text-6xl">
              <span className="text-brand-400">OpenCode</span>
              <span className="text-white/80">ABsUI</span>
              <span className="text-white/40">/UX</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/50 md:mt-5 md:text-base lg:text-lg">
              Enterprise-grade OpenCode ecosystem plugin and hybrid
              infrastructure manager. Bridging local dev environments with 24/7
              serverless cloud runtime.
            </p>
          </div>

          <MultiplayerGlobe />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="card-surface text-center">
                <div className="text-2xl font-bold text-brand-400">
                  {stat.value}
                </div>
                <div className="mt-1 text-sm text-white/40">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
