"use client"

/**
 * /vaults — RWA & DEFI VAULT STRATEGIES (template mapping: asset grid).
 * Deep-dive cards per vault: KYA report, fees, utilization, x402 audit
 * requirement, live NAV — plus the 1-click testnet sUSDC faucet.
 */
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { useDashboard } from "@/context/dashboard-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAccount, useWriteContract } from "wagmi"
import { pharosAtlanticChain } from "@/lib/wagmi"
import { pushNotification } from "@/components/dashboard/notification-toast"
import { Landmark, Droplets, FileCheck2, Gauge, PauseCircle, PlayCircle, ExternalLink, Loader2 } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

function VaultsInner() {
  const { vaults, system, blockPinned, formatSusdc, refresh } = useDashboard()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const [minting, setMinting] = useState(false)

  async function faucet() {
    if (!address || !system?.contracts.susdc) return
    setMinting(true)
    try {
      const hash = await writeContractAsync({
        account: address,
        chain: pharosAtlanticChain,
        address: system.contracts.susdc as `0x${string}`,
        abi: [{ type: "function", name: "faucet", inputs: [], outputs: [], stateMutability: "external" }],
        functionName: "faucet",
      })
      pushNotification("success", "Faucet minted", `10,000 sUSDC sent to your wallet · tx ${hash.slice(0, 14)}…`)
      setTimeout(() => void refresh(), 3000)
    } catch (e) {
      pushNotification("error", "Faucet failed", String(e).slice(0, 120))
    } finally {
      setMinting(false)
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-lime pulse-live" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Block {blockPinned ?? "—"} · Chain 688689</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">RWA & DeFi Vault Strategies</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Three distinct on-chain venues, each with its own fee schedule, risk profile and compliance posture.
          </p>
        </div>
        <Button size="sm" className="gap-2 bg-lime text-background hover:bg-lime/90" onClick={() => void faucet()} disabled={minting || !address}>
          {minting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplets className="w-4 h-4" />}
          Mint 10k test sUSDC
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {vaults.map((v) => {
          const apy = v.effectiveApyBps != null ? Number(v.effectiveApyBps) / 100 : null
          const kya = v.kyaCollateralRatioBps != null ? Number(v.kyaCollateralRatioBps) / 100 : null
          return (
            <div key={v.id} className={cn("bg-card border p-4 md:p-6", v.healthy ? "border-border" : "border-destructive/40")}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-lime/10 flex items-center justify-center">
                  <Landmark className="w-5 h-5 text-lime" />
                </div>
                <Badge variant="outline" className={cn("font-mono text-[10px]", v.healthy ? "text-lime border-lime/30" : "text-destructive border-destructive/30")}>
                  {v.healthy ? <PlayCircle className="w-3 h-3 mr-1" /> : <PauseCircle className="w-3 h-3 mr-1" />}
                  {v.healthy ? "ACTIVE" : "ISOLATED"}
                </Badge>
              </div>
              <h2 className="text-sm font-semibold leading-snug">{v.label}</h2>
              <p className="text-xs font-mono text-muted-foreground mt-1">{v.symbol} · {v.kind}</p>

              <div className="flex items-baseline gap-2 mt-4">
                <span className="text-3xl font-semibold tracking-tight">{apy != null ? `${apy.toFixed(2)}%` : "—"}</span>
                <span className="text-xs text-muted-foreground">effective APY</span>
              </div>

              <dl className="mt-4 space-y-2 text-xs font-mono">
                <Kv k="TVL" v={`${formatSusdc(v.totalAssets)} sUSDC`} />
                <Kv k="NAV / share" v={v.navPerShare != null ? v.navPerShare.toFixed(6) : "—"} />
                <Kv k="entry / exit fees" v={`${Number(v.entryFeeBps ?? 0n)} / ${Number(v.exitFeeBps ?? 0n)} bps (${pctOf(v.entryFeeBps)} / ${pctOf(v.exitFeeBps)})`} />
                <Kv k="KYA collateral" v={kya != null ? `${kya.toFixed(1)}%` : "—"} />
                {v.utilizationBps != null && <Kv k="utilization (dilution)" v={`${Number(v.utilizationBps) / 100}%`} />}
                <Kv k="x402 audit" v={v.x402AttestationRequired ? "REQUIRED (paid oracle)" : "not required"} />
              </dl>

              <div className="flex items-center gap-2 mt-4">
                <a
                  href={`${system?.network.explorer}/address/${v.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 text-xs font-mono px-3 py-2 bg-surface border border-border hover:bg-surface-hover transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> PharosScan
                </a>
                {v.x402AttestationRequired && (
                  <span className="flex items-center gap-1 text-xs font-mono text-chart-2 border border-chart-2/30 bg-chart-2/10 px-2 py-2">
                    <FileCheck2 className="w-3.5 h-3.5" /> audit-gated
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground border border-border bg-surface px-2 py-2">
                  <Gauge className="w-3.5 h-3.5" /> risk {v.id === "tbill" ? 12 : v.id === "credit" ? 58 : 34}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {vaults.length === 0 && (
        <div className="bg-card border border-border p-10 text-center text-sm text-muted-foreground">
          {system?.deployed
            ? "Syncing live vault states from Pharos Atlantic… (transient RPC hiccups retry automatically within 30s)"
            : "Vault states load once the suite is deployed (npm run deploy)."}
        </div>
      )}
    </div>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate">{v}</dd>
    </div>
  )
}

/** basis points -> percentage, e.g. 12 -> "0.12%", 0 -> "0%" */
function pctOf(bps: string | null | undefined): string {
  return `${Number((Number(bps ?? 0n) / 100).toFixed(4))}%`
}

export default function VaultsPage() {
  return (
    <DashboardLayout>
      <VaultsInner />
    </DashboardLayout>
  )
}
