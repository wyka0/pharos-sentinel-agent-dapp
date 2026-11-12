"use client"

/**
 * context/dashboard-context.tsx — Sentinel live desk state.
 * Maps the template's marketing dashboard context to the RWA agent domain.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useAccount } from "wagmi"

export interface VaultStateView {
  id: string
  label: string
  address: string
  kind: string
  symbol: string | null
  totalAssets: string | null
  totalSupplyShares: string | null
  navPerShare: number | null
  baseApyBps: string | null
  effectiveApyBps: string | null
  entryFeeBps: string | null
  exitFeeBps: string | null
  kyaCollateralRatioBps: string | null
  paused: boolean | null
  circuitBreakerTripped: boolean | null
  utilizationBps: string | null
  latestAuditHash: string | null
  x402AttestationRequired: boolean
  healthy: boolean
  degraded: boolean
  error?: string
}

export interface SystemInfo {
  network: { chainId: number; name: string; rpcUrl: string; explorer: string }
  deployed: boolean
  contracts: Record<string, string>
  /** global on-chain whitelist state (renders without a connected wallet) */
  vaultWhitelist?: Record<string, boolean>
  /** global firewall counters (totalGuardedVolume / totalBlockedAttempts, micro-sUSDC) */
  firewallStats?: { totalGuardedVolume: string; totalBlockedAttempts: string } | null
  policyDefaults?: {
    maxPerTxSpend: string
    maxSlippageBps: string
    requireWhitelistedVault: boolean
    requireValidX402Attestation: boolean
    emergencyPaused: boolean
  }
  skillEngine: { runs: number; observations: number; registry: Array<{ name: string; description: string; memory: string }> }
  x402: { sessionSpent: string; sessionBudgetCap: string; payments: number }
}

export interface TrendInfo {
  runs: number
  observationCount: number
  /** FULL-history 30d counters from /api/trend (not just the recent window) */
  spikesRejected30d?: number
  rebalanceTriggered30d?: number
  recentVerdicts: Array<{ vaultId: string; verdict: string; reason: string; ts: number; recommendation?: string; blockNumber?: number; pinned?: boolean }>
  x402Ledger: { sessionSpent: string; sessionBudgetCap: string; payments: Array<{ provider: string; feePaid: string; receiptHash: string; ts: number }> }
  /** horizon reference from /api/vaults: top router net APY + net yield for 2,500 sUSDC · 30d */
  horizonReference?: { depositSusdc: string; horizonDays: number; topNetApyBps: string | null; topNetSusdc: string | null; winnerId: string | null } | null
  catalog?: Array<{ id: string; label: string; baseApyBps?: string | number; riskScore?: number; [k: string]: unknown }>
  addresses?: Record<string, string>
  error?: string
}

interface DashboardState {
  system: SystemInfo | null
  vaults: VaultStateView[]
  blockPinned: number | null
  healthyVaults: string[]
  isolatedVaults: string[]
  trend: TrendInfo | null
  horizonReference: { depositSusdc: string; horizonDays: number; topNetApyBps: string | null; topNetSusdc: string | null; winnerId: string | null } | null
  loading: boolean
  lastRefresh: Date | null
  userAddress: string | undefined
  refresh: () => Promise<void>
  formatSusdc: (micro: string | bigint | null | undefined) => string
}

const DashboardContext = createContext<DashboardState | null>(null)

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount()
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [vaults, setVaults] = useState<VaultStateView[]>([])
  const [blockPinned, setBlockPinned] = useState<number | null>(null)
  const [healthyVaults, setHealthy] = useState<string[]>([])
  const [isolatedVaults, setIsolated] = useState<string[]>([])
  const [trend, setTrend] = useState<TrendInfo | null>(null)
  const [horizonReference, setHorizonReference] = useState<DashboardState["horizonReference"]>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [sysRes, vaultRes, trendRes] = await Promise.allSettled([
        fetch("/api/system").then((r) => r.json()),
        fetch("/api/vaults").then((r) => r.json()),
        fetch("/api/trend").then((r) => r.json()),
      ])
      if (sysRes.status === "fulfilled") setSystem(sysRes.value)
      if (vaultRes.status === "fulfilled" && vaultRes.value.ok) {
        setVaults(vaultRes.value.vaults ?? [])
        setBlockPinned(vaultRes.value.blockPinned ?? null)
        setHealthy(vaultRes.value.healthyVaults ?? [])
        setIsolated(vaultRes.value.isolatedVaults ?? [])
        setHorizonReference(vaultRes.value.horizonReference ?? null)
      }
      if (trendRes.status === "fulfilled") setTrend(trendRes.value)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(t)
  }, [refresh])

  const formatSusdc = useCallback((micro: string | bigint | null | undefined): string => {
    if (micro == null) return "—"
    let v: bigint
    try {
      v = typeof micro === "bigint" ? micro : BigInt(micro)
    } catch {
      return "—"
    }
    const neg = v < 0n
    const abs = neg ? -v : v
    const whole = abs / 1_000_000n
    const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2)
    return `${neg ? "-" : ""}${whole.toLocaleString()}.${frac}`
  }, [])

  const value = useMemo<DashboardState>(
    () => ({ system, vaults, blockPinned, healthyVaults, isolatedVaults, trend, horizonReference, loading, lastRefresh, userAddress: address, refresh, formatSusdc }),
    [system, vaults, blockPinned, healthyVaults, isolatedVaults, trend, horizonReference, loading, lastRefresh, address, refresh, formatSusdc],
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider")
  return ctx
}
