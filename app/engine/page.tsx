"use client"

/**
 * /engine — TREND MEMORY & NET-YIELD CURVE (template mapping: Performance
 * charts). Multi-observation Stateful Trend Guard visualization: single
 * noisy spike IGNORED (SPIKE_REJECTED) vs confirmed 3-check trend ACTED on.
 * Plus the HorizonNetYieldRouter net-yield curve across all 3 vaults.
 */
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { useDashboard } from "@/context/dashboard-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, ReferenceLine } from "recharts"
import { BrainCircuit, RefreshCw, TrendingDown, ShieldQuestion, Activity } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

const SPIKE_DEMO = [100, 93, 100] // single noisy drop -> rejected
const TREND_DEMO = [100, 98, 95, 92] // 3 consecutive drops -> confirmed

/** color coding per verdict kind (incl. routing/memory verdicts) */
function verdictStyle(verdict: string): string {
  switch (verdict) {
    case "TREND_CONFIRMED":
      return "text-chart-3 border-chart-3/30"
    case "SPIKE_REJECTED":
      return "text-chart-2 border-chart-2/30"
    case "OPTIMAL_ROUTE_COMMITTED":
      return "text-lime border-lime/30"
    case "REBALANCE_TRIGGERED":
      return "text-chart-5 border-chart-5/30"
    case "STABLE":
      return "text-muted-foreground border-border"
    default:
      return "text-muted-foreground border-border"
  }
}

function EngineInner() {
  const { trend, vaults, refresh, loading, formatSusdc } = useDashboard()
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult] = useState<{ scenario: string; verdict: string; reason: string } | null>(null)

  // net-yield curve (per 1,000 sUSDC, 30d) from live effective APYs
  const yieldCurve = vaults
    .filter((v) => v.effectiveApyBps != null)
    .map((v) => ({
      name: v.symbol ?? v.id,
      apy: Number(v.effectiveApyBps) / 100,
      net30: (1000 * (Number(v.effectiveApyBps) / 10000) * 30) / 365,
      fill: v.id === "tbill" ? "var(--chart-1)" : v.id === "credit" ? "var(--chart-2)" : "var(--chart-4)",
    }))

  const navSeries = [
    { name: "obs 1", spike: SPIKE_DEMO[0], trend: TREND_DEMO[0] },
    { name: "obs 2", spike: SPIKE_DEMO[1], trend: TREND_DEMO[1] },
    { name: "obs 3", spike: SPIKE_DEMO[2], trend: TREND_DEMO[2] },
    { name: "obs 4", spike: null, trend: TREND_DEMO[3] },
  ]

  async function runScenario(kind: "spike" | "trend") {
    setSimulating(true)
    try {
      const navs = kind === "spike" ? SPIKE_DEMO : TREND_DEMO
      let last
      for (const [i, nav] of navs.entries()) {
        const res = await fetch("/api/trend", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vaultId: "harbor", navMicro: String(BigInt(nav) * 1_000_000n), scenario: `${kind}-${i}` }),
        })
        last = await res.json()
      }
      setSimResult(last ? { scenario: kind === "spike" ? "100 → 93 → 100 (single noisy drop)" : "100 → 98 → 95 → 92 (3 consecutive drops)", verdict: last.verdict, reason: last.reason } : null)
    } finally {
      setSimulating(false)
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-lime pulse-live" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">SkillEngine · Persistent Memory</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Stateful Trend Memory & Net-Yield Engine</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            ≥3-observation rule: ignore one noisy spike, act on a confirmed 3-check trend. Memory persists in .data/sentinel-state.json (atomic writes).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-2 bg-transparent">
          <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
          Refresh
        </Button>
      </div>

      {/* Trend guard demo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
        <div className="lg:col-span-2 bg-card border border-border p-4 md:p-6">
          <h2 className="text-sm font-medium mb-1 flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-lime" /> Multi-Observation NAV Trend Guard
          </h2>
          <p className="text-xs text-muted-foreground font-mono mb-4">
            {trend?.observationCount ?? 0} observations persisted · {trend?.runs ?? 0} engine runs · deterministic observationId dedup
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={navSeries}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis domain={[85, 102]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 0 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="spike" name="single spike (REJECTED)" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="trend" name="3-check downtrend (ACTED)" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button size="sm" variant="outline" disabled={simulating} onClick={() => void runScenario("spike")} className="gap-2 bg-transparent">
              <ShieldQuestion className="w-3.5 h-3.5" /> Replay: single spike
            </Button>
            <Button size="sm" variant="outline" disabled={simulating} onClick={() => void runScenario("trend")} className="gap-2 bg-transparent">
              <TrendingDown className="w-3.5 h-3.5" /> Replay: 3-drop trend
            </Button>
          </div>
          {simResult && (
            <div className={cn("mt-3 p-3 border font-mono text-xs", simResult.verdict === "TREND_CONFIRMED" ? "bg-chart-3/10 border-chart-3/30 text-chart-3" : "bg-surface border-border")}>
              <p className="font-semibold">{simResult.verdict} — {simResult.scenario}</p>
              <p className="mt-1 opacity-80">{simResult.reason}</p>
            </div>
          )}
        </div>

        {/* Verdict log */}
        <div className="bg-card border border-border">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-medium">Recent Skill Verdicts</h2>
            <p className="text-xs text-muted-foreground font-mono mt-1">.data/sentinel-state.json · atomic tmp→fsync→rename</p>
          </div>
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {(trend?.recentVerdicts ?? []).slice(0, 12).map((v, i) => (
              <div key={i} className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn("font-mono text-[10px]", verdictStyle(v.verdict))}>
                    {v.verdict}
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground">{v.vaultId}</span>
                  {v.pinned && (
                    <span className="text-[10px] font-mono text-lime border border-lime/30 px-1 py-px" title="pinned: latest notable verdict (kept visible so auto-polling cannot overwrite it)">
                      pinned
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                    {v.blockNumber ? `blk ${v.blockNumber}` : "—"} · {new Date(v.ts).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs mt-1 line-clamp-2">{v.reason || v.recommendation || "verdict recorded"}</p>
              </div>
            ))}
            {(trend?.recentVerdicts ?? []).length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">No verdicts yet — run a scenario replay.</p>
            )}
          </div>
        </div>
      </div>

      {/* Net yield curve */}
      <div className="bg-card border border-border p-4 md:p-6">
        <h2 className="text-sm font-medium mb-1 flex items-center gap-2">
          <Activity className="w-4 h-4 text-lime" /> Horizon-Adjusted Net-Yield Curve (per 1,000 sUSDC · 30d)
        </h2>
        <p className="text-xs text-muted-foreground font-mono mb-4">
          live effectiveApyBps from Chain MCP (credit venue = utilization-diluted) · x402 audit fee 0.025 sUSDC priced in for gated venues
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={yieldCurve}>
              <defs>
                {yieldCurve.map((s) => (
                  <linearGradient key={s.name} id={`grad-${s.name}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.fill} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={s.fill} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} unit="%" />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 0 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="apy" name="effective APY %" stroke="var(--chart-1)" fill="url(#grad-pTBILL)" strokeWidth={2} />
              <Area type="monotone" dataKey="net30" name="net 30d yield (sUSDC)" stroke="var(--chart-4)" fill="url(#grad-hBUF)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default function EnginePage() {
  return (
    <DashboardLayout>
      <EngineInner />
    </DashboardLayout>
  )
}
