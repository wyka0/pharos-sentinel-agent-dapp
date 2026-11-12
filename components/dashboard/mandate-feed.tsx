"use client"

/**
 * mandate-feed.tsx — "Active Agent Mandates" table (campaign-feed mapping):
 * every RWA & DeFi vault renders as a live mandate row with status badge,
 * APY, fees, KYA ratio and pause/breaker state.
 */
import { cn } from "@/lib/utils"
import { ExternalLink, Zap, ShieldAlert, ShieldCheck } from "lucide-react"
import { useDashboard, type VaultStateView } from "@/context/dashboard-context"

const KIND_LABEL: Record<string, string> = {
  RWA: "RWA · T-BILL",
  "RWA-Private-Credit": "RWA · SENIOR CREDIT",
  DeFi: "DEFI · LIQUIDITY",
}

/** basis points -> percentage label, e.g. 12 -> "0.12%", 0 -> "0%" */
function fmtPct(bps: string | null | undefined): string {
  const pct = Number(bps ?? 0n) / 100
  return `${Number(pct.toFixed(4))}%`
}

export function MandateFeed({ vaults }: { vaults: VaultStateView[] }) {
  const { system } = useDashboard()
  return (
    <div className="bg-card border border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium">Active Agent Mandates — RWA & DeFi Vault Strategies</h2>
        <span className="text-xs text-muted-foreground font-mono">
          {vaults.filter((v) => v.healthy).length} healthy / {vaults.length} total
        </span>
      </div>

      <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
        {vaults.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No mandates loaded yet — deploy the suite with <code className="font-mono">npm run deploy</code>.
          </div>
        )}
        {vaults.map((v) => {
          const apy = v.effectiveApyBps ? Number(v.effectiveApyBps) / 100 : null
          const kya = v.kyaCollateralRatioBps ? Number(v.kyaCollateralRatioBps) / 100 : null
          const whitelisted = system?.contracts?.policyFirewall ? true : false
          return (
            <div key={v.id} className="p-3 md:p-4 flex flex-wrap items-center gap-3 md:gap-4 hover:bg-surface-hover transition-colors group">
              {/* Status */}
              <div
                className={cn(
                  "w-20 text-center px-2 py-1 text-xs font-mono border shrink-0",
                  v.healthy ? "bg-lime/20 text-lime border-lime/30 pulse-live" : "bg-destructive/20 text-destructive border-destructive/30",
                )}
              >
                {v.healthy ? "ACTIVE" : "ISOLATED"}
              </div>

              {/* Identity */}
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  {v.label}
                  {v.x402AttestationRequired && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-chart-2/20 text-chart-2 border border-chart-2/30">x402 REQUIRED</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground font-mono truncate">{KIND_LABEL[v.kind] ?? v.kind} · {v.symbol ?? "—"}</p>
              </div>

              {/* APY */}
              <div className="w-20 text-right">
                <p className="text-sm font-mono">{apy != null ? `${apy.toFixed(2)}%` : "—"}</p>
                <p className="text-[10px] text-muted-foreground font-mono">eff. APY</p>
              </div>

              {/* Fees */}
              <div className="w-28 text-right hidden md:block">
                <p className="text-sm font-mono">
                  {Number(v.entryFeeBps ?? 0n)}/{Number(v.exitFeeBps ?? 0n)} bps
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {fmtPct(v.entryFeeBps)} / {fmtPct(v.exitFeeBps)}
                </p>
              </div>

              {/* KYA */}
              <div className="w-20 text-right hidden lg:block">
                <p className="text-sm font-mono">{kya != null ? `${kya.toFixed(1)}%` : "—"}</p>
                <p className="text-[10px] text-muted-foreground font-mono">KYA ratio</p>
              </div>

              {/* Guard + link */}
              <div className="flex items-center gap-2 shrink-0">
                {v.healthy ? (
                  <ShieldCheck className="w-4 h-4 text-lime" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-destructive" />
                )}
                <a
                  href={`${system?.network.explorer ?? "https://atlantic.pharosscan.xyz"}/address/${v.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 hover:bg-surface border border-transparent hover:border-border transition-colors"
                  title="PharosScan"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                </a>
              </div>
            </div>
          )
        })}
      </div>

      <div className="p-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-mono">whitelist enforced on-chain by SentinelPolicyFirewall</span>
        <span className="text-xs font-mono text-lime flex items-center gap-1">
          <Zap className="w-3 h-3" /> same-block pinned reads
        </span>
      </div>
    </div>
  )
}
