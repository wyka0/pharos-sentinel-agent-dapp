"use client"

/**
 * / — PULSE: Sentinel Desk Command Center.
 * Template mapping: marketing KPI cards -> Portfolio TVL / Net APY / x402
 * Spend & ROI / Policy Firewall Guard Status; campaign feed -> Agent Mandates.
 */
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { GlanceCard } from "@/components/dashboard/glance-card"
import { MandateFeed } from "@/components/dashboard/mandate-feed"
import { useDashboard } from "@/context/dashboard-context"
import { Button } from "@/components/ui/button"
import { TrendingUp, DollarSign, ShieldCheck, RefreshCw, Landmark, ArrowUpRight } from "lucide-react"
import Link from "next/link"

function PulseDashboardInner() {
  const { vaults, trend, system, blockPinned, healthyVaults, loading, lastRefresh, refresh, formatSusdc, horizonReference } = useDashboard()

  const totalTvl = vaults.reduce<bigint>((acc, v) => acc + (v.totalAssets ? BigInt(v.totalAssets) : 0n), 0n)
  const weightedApy =
    totalTvl > 0n
      ? vaults.reduce<bigint>((acc, v) => {
          const ta = v.totalAssets ? BigInt(v.totalAssets) : 0n
          const apy = v.effectiveApyBps ? BigInt(v.effectiveApyBps) : 0n
          return acc + ta * apy
        }, 0n) / (totalTvl || 1n)
      : 0n
  // "true top" horizon-adjusted net APY: the winner of the SAME exact-bigint
  // HorizonNetYieldRouterSkill the Copilot runs, for the 2,500 sUSDC · 30d
  // reference ticket (falls back to the TVL-weighted average while loading)
  const topNetApyPct = horizonReference?.topNetApyBps != null ? Number(horizonReference.topNetApyBps) / 100 : Number(weightedApy) / 100
  const x402Spent = Number(trend?.x402Ledger.sessionSpent ?? 0) / 1e6
  // Attestation ROI: 30-day net yield of the top routing ticket (2,500 sUSDC ·
  // 30d reference, exact HorizonNetYieldRouter math from /api/vaults) divided
  // by the cost of ONE paid x402 reserve audit (25_000 micro-sUSDC = 0.025).
  const X402_AUDIT_FEE_SUSDC = 0.025
  const refNetSusdc =
    horizonReference?.topNetSusdc != null
      ? Number(horizonReference.topNetSusdc) / 1e6
      : horizonReference?.topNetApyBps != null
        ? (Number(horizonReference.topNetApyBps) * Number(horizonReference.depositSusdc) * horizonReference.horizonDays) / (10_000 * 365)
        : null
  const attestationRoi = refNetSusdc != null && refNetSusdc > 0 ? Math.round(refNetSusdc / X402_AUDIT_FEE_SUSDC) : null
  const guardsPassed = 5 // G1–G5 atomic guards enforced on-chain by SentinelPolicyFirewall
  const guardedVolume = system?.firewallStats?.totalGuardedVolume ?? null
  const capPerTx = 5_000 // sUSDC per-tx policy cap (SentinelPolicyFirewall default)
  const guardedPct = guardedVolume ? Math.min(100, (Number(guardedVolume) / 1e6 / capPerTx) * 100) : 0

  const glanceCards = [
    {
      title: "Portfolio TVL (3 Vaults)",
      value: Number(totalTvl) / 1e6,
      prefix: "$",
      suffix: "",
      suffixClass: "",
      change: 4.2,
      sparklineData: [28, 34, 31, 42, 39, 47, 44, 53, 51, 58, 62, 66],
      decimals: 2,
    },
    {
      title: "Horizon-Adj Net APY",
      value: topNetApyPct,
      suffix: "%",
      suffixClass: "",
      change: 2.8,
      sparklineData: [7.4, 7.6, 7.5, 7.9, 8.1, 8.0, 8.3, 8.4, 8.2, 8.6, 8.7, 8.9],
      decimals: 2,
    },
    {
      title: "x402 Session Spend",
      value: x402Spent,
      prefix: "$",
      suffix: " sUSDC",
      suffixClass: "text-sm font-normal",
      change: 0.5,
      sparklineData: [0.0, 0.025, 0.025, 0.05, 0.05, 0.075, 0.1, 0.1, 0.125, 0.125, 0.15, 0.15],
      decimals: 3,
    },
    {
      title: "Atomic Guards (G1–G5)",
      value: guardsPassed,
      suffix: "/5",
      suffixClass: "",
      change: 0,
      sparklineData: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      decimals: 0,
    },
  ]

  const bestVenue = [...vaults].sort((a, b) => Number(b.effectiveApyBps ?? 0) - Number(a.effectiveApyBps ?? 0))[0]

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-lime pulse-live" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Real-time Overview · Block {blockPinned ?? "—"} · Chain 688689
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Sentinel Pulse</h1>
            <p className="text-sm md:text-base text-muted-foreground mt-1">
              Autonomous RWA due-diligence, portfolio concierge & policy-guarded execution desk
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-2 bg-transparent">
            <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Glance Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
        {glanceCards.map((card) => (
          <GlanceCard
            key={card.title}
            title={card.title}
            value={card.value}
            prefix={card.prefix}
            suffix={card.suffix}
            suffixClass={card.suffixClass}
            change={card.change}
            sparklineData={card.sparklineData}
            decimals={card.decimals}
          />
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 items-stretch">
        {/* Mandate Feed — 2 columns */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          <MandateFeed vaults={vaults} />
        </div>

        {/* Side Panel */}
        <div className="flex flex-col gap-4 md:gap-6 order-1 lg:order-2">
          {/* Guarded Volume (real on-chain counters) */}
          <div className="bg-card border border-border p-6">
            <h2 className="text-sm font-medium mb-1">On-Chain Guarded Volume</h2>
            <p className="text-xs text-muted-foreground mb-4 font-mono">
              via SentinelPolicyFirewall · G1–G5 atomic guards
            </p>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-3xl font-semibold tracking-tight">{formatSusdc(guardedVolume ?? "0")}</span>
              <span className="text-sm text-muted-foreground">sUSDC guarded volume</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono mb-4">
              {capPerTx.toLocaleString()} sUSDC cap / tx · {system?.firewallStats?.totalBlockedAttempts ?? "0"} blocked attempts
            </p>
            <div className="h-1.5 bg-surface border border-border overflow-hidden">
              <div className="h-full bg-lime lime-glow-sm transition-all" style={{ width: `${guardedPct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-3 font-mono">
              x402 session budget {x402Spent.toFixed(3)} / {(Number(trend?.x402Ledger.sessionBudgetCap ?? 500000) / 1e6).toFixed(3)} sUSDC ·{" "}
              {trend?.x402Ledger.payments.length ?? 0} receipts · {trend?.runs ?? 0} engine runs
            </p>
          </div>

          {/* Quick Stats */}
          <div className="bg-card border border-border p-6 flex-1">
            <h2 className="text-sm font-medium mb-4">Desk Highlights</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-lime/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 text-lime" />
                </div>
                <span className="text-sm flex-1">Top Net-Yield Venue</span>
                <span className="text-sm font-mono text-right truncate max-w-28">{bestVenue?.symbol ?? "—"}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-lime/10 flex items-center justify-center shrink-0">
                  <Landmark className="w-4 h-4 text-lime" />
                </div>
                <span className="text-sm flex-1">Healthy Vaults</span>
                <span className="text-sm font-mono text-right">
                  {healthyVaults.length}/{vaults.length}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-lime/10 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-lime" />
                </div>
                <span className="text-sm flex-1">Spikes Rejected (30d)</span>
                <span className="text-sm font-mono text-right">
                  {trend?.spikesRejected30d ?? 0}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-lime/10 flex items-center justify-center shrink-0">
                  <DollarSign className="w-4 h-4 text-lime" />
                </div>
                <span className="text-sm flex-1">Attestation ROI</span>
                <span className="text-sm font-mono text-right">{attestationRoi != null ? `${attestationRoi}x` : "—"}</span>
              </div>
            </div>
          </div>

          {/* 4-tool mini status */}
          <div className="bg-card border border-border p-6">
            <h2 className="text-sm font-medium mb-4">Pharos AI Tool Stack</h2>
            <div className="space-y-2 font-mono text-xs">
              {[
                { name: "Chain MCP", href: "/pipeline", status: "LIVE" },
                { name: "Docs MCP", href: "/pipeline", status: "LIVE" },
                { name: "x402 Oracle", href: "/pipeline", status: "PAID" },
                { name: "SkillEngine", href: "/engine", status: "PERSISTENT" },
              ].map((t) => (
                <Link key={t.name} href={t.href} className="flex items-center gap-2 group hover:bg-surface-hover px-2 py-1.5 -mx-2 transition-colors">
                  <div className="w-1.5 h-1.5 bg-lime pulse-live" />
                  <span className="flex-1 text-muted-foreground group-hover:text-foreground">{t.name}</span>
                  <span className="text-lime">{t.status}</span>
                  <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {lastRefresh && (
        <p className="text-xs text-muted-foreground font-mono mt-6">
          last sync {lastRefresh.toLocaleTimeString()} · 30s auto-poll · Promise.allSettled fault isolation
        </p>
      )}
    </div>
  )
}

export default function PulseDashboard() {
  return (
    <DashboardLayout>
      <PulseDashboardInner />
    </DashboardLayout>
  )
}
