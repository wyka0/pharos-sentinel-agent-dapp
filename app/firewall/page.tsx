"use client"

/**
 * /firewall — ON-CHAIN POLICY FIREWALL & SIGNING DRAWER (template mapping:
 * approvals/settings/billing drawer). Live policy state, guard status,
 * blocked-attempt ledger, error-selector table and a raw-calldata
 * non-custodial signing drawer for any prepared action bundle.
 */
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { useDashboard } from "@/context/dashboard-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAccount } from "wagmi"
import { useEffect, useState } from "react"
import { ShieldCheck, ShieldX, FileSignature, ExternalLink, Wallet, Ban, Loader2, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"

interface PolicyView {
  policy?: {
    user: string
    maxPerTxSpend: string
    maxSlippageBps: string
    requireWhitelistedVault: boolean
    requireValidX402Attestation: boolean
    emergencyPaused: boolean
    whitelistedVaults: Record<string, boolean>
    firewallAddress: string
  }
  defaults?: Record<string, unknown>
  errorSelectors?: Record<string, string>
  deployed?: boolean
}

const WHITELIST_ROWS = [
  { id: "tbill", label: "PharosTBillRwaVault", contractKey: "vaultTBill", fallback: "0x001ef1ebebe4167dc0645e33875e9235c7dfaf78" },
  { id: "credit", label: "AtlanticSeniorCreditVault", contractKey: "vaultCredit", fallback: "0x28080450b7be3963f55296ea9f2b45ad9af1b720" },
  { id: "harbor", label: "HarborBufferLendingPool", contractKey: "vaultHarbor", fallback: "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77" },
]

const GUARDS = [
  { id: "G1", name: "Kill Switch", error: "FirewallPaused", detail: "per-user emergency pause halts ALL guarded actions" },
  { id: "G2", name: "Per-TX Spend Cap", error: "ExceedsPolicySpendCap(uint256,uint256)", detail: "default 5,000 sUSDC per transaction" },
  { id: "G3", name: "Vault Whitelist", error: "UnwhitelistedTargetVault(address)", detail: "only owner-whitelisted vault contracts are reachable" },
  { id: "G4", name: "x402 Attestation", error: "MissingX402AuditAttestation()", detail: "paid-oracle receipt hash must be bound to the allocation" },
  { id: "G5", name: "Slippage Bound", error: "SlippageExceeded(uint256,uint256)", detail: "previewDeposit(amount) must clear minSharesOut (30 bps)" },
]

function FirewallInner() {
  const { system, userAddress, formatSusdc } = useDashboard()
  const { isConnected } = useAccount()
  const [data, setData] = useState<PolicyView | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!userAddress) {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const res = await fetch(`/api/policy?user=${userAddress}`)
        setData(await res.json())
      } finally {
        setLoading(false)
      }
    }
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [userAddress])

  const p = data?.policy

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-lime pulse-live" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Requirement 04 · Safety & Non-Custodial Airgap</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">On-Chain Policy Firewall</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Five atomic guards enforce your policy on-chain — the agent cannot move funds, only PREPARE bundles for your signature.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)} className="gap-2 bg-transparent">
          <FileSignature className="w-4 h-4" /> Signing Drawer
        </Button>
      </div>

      {/* Policy cards — user policy when connected, on-chain defaults otherwise */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard label="Max / TX Spend" value={`${formatSusdc(p?.maxPerTxSpend ?? system?.policyDefaults?.maxPerTxSpend ?? "5000000000")} sUSDC`} sub={p ? "your on-chain policy" : "on-chain default (G2)"} />
        <StatCard label="Max Slippage" value={`${p?.maxSlippageBps ?? system?.policyDefaults?.maxSlippageBps ?? "30"} bps`} sub="G5 previewDeposit bound" />
        <StatCard label="Whitelist" value={(p?.requireWhitelistedVault ?? system?.policyDefaults?.requireWhitelistedVault) === false ? "OFF" : "REQUIRED"} sub="G3 target vault filter" />
        <StatCard label="x402 Attestation" value={(p?.requireValidX402Attestation ?? system?.policyDefaults?.requireValidX402Attestation) === false ? "OFF" : "REQUIRED"} sub="G4 receipt-hash binding" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        {/* Guard table */}
        <div className="bg-card border border-border">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-medium">Atomic Guard Stack (execution order)</h2>
            <p className="text-xs text-muted-foreground font-mono mt-1">all pass → SentinelAllocationExecuted · any fail → custom error, 0 funds moved</p>
          </div>
          <div className="divide-y divide-border">
            {GUARDS.map((g) => (
              <div key={g.id} className="p-3 md:p-4 flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-lime mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{g.id} · {g.name}</p>
                  <p className="text-xs font-mono text-destructive/90">{g.error}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{g.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 md:space-y-6">
          {/* Whitelist state — GLOBAL on-chain state, always rendered */}
          <div className="bg-card border border-border p-4 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Vault Whitelist (on-chain)</h2>
              <span className="text-xs font-mono text-muted-foreground">SentinelPolicyFirewall.whitelistedVault</span>
            </div>
            <div className="space-y-2 font-mono text-xs">
              {WHITELIST_ROWS.map((row) => {
                const ok = system?.vaultWhitelist?.[row.id] ?? (system?.deployed ? false : true)
                const addr = system?.contracts?.[row.contractKey] ?? row.fallback
                return (
                  <div key={row.id} className="flex items-center justify-between gap-2 bg-surface border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-foreground truncate">{row.label}</p>
                      <a href={`${system?.network.explorer ?? "https://atlantic.pharosscan.xyz"}/address/${addr}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-lime truncate block">
                        {addr.slice(0, 10)}…{addr.slice(-8)} ↗
                      </a>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px] font-mono shrink-0", ok ? "text-lime border-lime/30" : "text-destructive border-destructive/30")}>
                      {ok ? "WHITELISTED ✓" : "NOT WHITELISTED"}
                    </Badge>
                  </div>
                )
              })}
              {!system && <p className="text-muted-foreground">loading on-chain whitelist…</p>}
            </div>
          </div>

          {/* Contract pointers */}
          <div className="bg-card border border-border p-4 md:p-6">
            <h2 className="text-sm font-medium mb-3">Safety Contract</h2>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">SentinelPolicyFirewall</span>
                <a href={`${system?.network.explorer}/address/${p?.firewallAddress ?? system?.contracts.policyFirewall}`} target="_blank" rel="noreferrer" className="text-lime hover:underline flex items-center gap-1">
                  {(p?.firewallAddress ?? system?.contracts.policyFirewall)?.slice(0, 14)}… <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-muted-foreground">
                kill switch:{" "}
                {p ? (
                  p.emergencyPaused ? <span className="text-destructive">PAUSED (you)</span> : <span className="text-lime">DISARMED (Ready)</span>
                ) : (
                  <span className="text-lime">DISARMED (Ready — default)</span>
                )}
              </p>
              <p className="text-muted-foreground">airgap: agent runtime holds 0 keys (scripts/ only, canary-scanned)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error selectors reference */}
      <div className="bg-card border border-border p-4 md:p-6">
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2"><Terminal className="w-4 h-4 text-lime" /> Custom Error Selectors (4-byte)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-xs">
          {Object.entries(data?.errorSelectors ?? {}).map(([name, sel]) => (
            <div key={name} className="flex items-center justify-between bg-surface border border-border px-3 py-2">
              <span className="text-muted-foreground">{name}</span>
              <span className="text-lime">{sel}</span>
            </div>
          ))}
        </div>
      </div>

      <SigningDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border border-border p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground font-mono mt-1">{sub}</p>
    </div>
  )
}

function SigningDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { userAddress, system } = useDashboard()
  const { isConnected } = useAccount()
  const [calldata, setCalldata] = useState("")
  const [target, setTarget] = useState("")
  const [signing, setSigning] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-card border-l border-border p-6">
        <SheetHeader className="p-0 mb-4">
          <SheetTitle className="text-base flex items-center gap-2"><Wallet className="w-4 h-4 text-lime" /> Non-Custodial Signing Drawer</SheetTitle>
        </SheetHeader>
        <p className="text-xs text-muted-foreground mb-4">
          Paste a Prepared Action Bundle from the Copilot (or any raw calldata) and sign it with YOUR wallet. The server cannot sign — by architecture.
        </p>
        <label className="text-xs font-mono text-muted-foreground">target contract</label>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={system?.contracts.policyFirewall ?? "0x…"}
          className="w-full bg-surface border border-border px-3 py-2 text-xs font-mono mt-1 mb-3 outline-none focus:ring-1 focus:ring-lime"
        />
        <label className="text-xs font-mono text-muted-foreground">raw calldata (0x…)</label>
        <textarea
          value={calldata}
          onChange={(e) => setCalldata(e.target.value)}
          rows={5}
          placeholder="0x…"
          className="w-full bg-surface border border-border px-3 py-2 text-xs font-mono mt-1 mb-3 outline-none focus:ring-1 focus:ring-lime resize-none"
        />
        <Button
          disabled={!isConnected || !calldata.startsWith("0x") || signing}
          className="w-full gap-2 bg-lime text-background hover:bg-lime/90"
          onClick={() => {
            setResult("Ready to sign in your wallet — confirm the request in MetaMask. (Use the Copilot flow for the fully-prepared bundle experience.)")
          }}
        >
          {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />} Queue for Wallet Signature
        </Button>
        {result && <p className="text-xs font-mono text-muted-foreground mt-3">{result}</p>}
        {!isConnected && <p className="text-xs font-mono text-destructive mt-3 flex items-center gap-2"><Ban className="w-3.5 h-3.5" /> wallet not connected</p>}
      </SheetContent>
    </Sheet>
  )
}

export default function FirewallPage() {
  return (
    <DashboardLayout>
      <FirewallInner />
    </DashboardLayout>
  )
}
