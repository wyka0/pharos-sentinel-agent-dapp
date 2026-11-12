"use client"

/**
 * /copilot — AGENT INTENT COPILOT (template mapping: "Campaign Builder").
 * Natural-language intent bar + structured sliders (Deposit Size, Holding
 * Horizon, Risk Ceiling) -> live 4-tool Pharos AI pipeline -> non-custodial
 * Prepared Action Bundle -> user signs with the connected wallet.
 */
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { useDashboard } from "@/context/dashboard-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAccount, useSignTypedData, useWriteContract } from "wagmi"
import { pharosAtlanticChain } from "@/lib/wagmi"
import { canonicalAttestationBrowser, hashCanonicalBrowser, parseChallengeHeader } from "@/lib/x402/browser-client"
import { cn } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"
import {
  Sparkles, Workflow, ShieldCheck, ShieldX, CircleDollarSign, FileCheck2, Cpu, Wallet, ExternalLink, Loader2, ArrowRight, AlertTriangle, CheckCircle2,
} from "lucide-react"

interface PipelineStep {
  tool: string
  call: string
  ok: boolean
  latencyMs: number
  summary: string
}

interface Bundle {
  kind: string
  description: string
  to: string
  data: string
  value: string
  chainId: number
  approvals: Array<{ to: string; data: string; value: string; summary: string }>
  policyCheckReport: { passed: boolean; outcomes: Array<{ guard: string; passed: boolean; detail: string }> }
  x402ReceiptHash: string
  agentIntentDigest: string
  minSharesOut: string
}

interface AgentOutcome {
  status: "prepared" | "payment_required" | "blocked" | "advisory"
  pipeline: PipelineStep[]
  bundle?: Bundle
  blocked?: { reason: string; failingGuards: Array<{ guard: string; detail: string; customError: string }> }
  advisory?: { summary: string }
  intent?: { amount: string; horizonDays: number; riskCeiling: number; action: string }
  routing?: { winner?: { id: string; label: string; breakdown: { netReturn: string; netApyBps: string } } }
}

/** demo viewer address used for read-only flows before a wallet is connected */
const REVIEWER_ADDRESS = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C"

/** 1-Click Reviewer Verification Flows */
const FLOWS: Array<{
  id: number
  title: string
  desc: string
  prompt: string
  deposit: number
  horizon: number
  risk: number
  trendObservations?: Array<{ vaultId: string; navMicro: string }>
  outageDrill?: string[]
  skipX402?: boolean
  useSessionReceipt?: boolean
}> = [
  {
    id: 1,
    title: "Flow #1 — Optimal RWA Allocation",
    desc: "2,500 sUSDC · 30d · x402 Session Receipt",
    prompt: "Deposit 2500 sUSDC for 30 days, moderate risk — run due diligence first",
    deposit: 2500,
    horizon: 30,
    risk: 60,
    useSessionReceipt: true,
  },
  {
    id: 2,
    title: "Flow #2 — 3-Observation Trend Guard",
    desc: "Ignore 1 Spike vs. Act on 3 Drops",
    prompt: "Rebalance and protect my credit position — confirmed downtrend",
    deposit: 2500,
    horizon: 30,
    risk: 60,
    trendObservations: [100, 98, 95, 92].map((nav) => ({ vaultId: "credit", navMicro: String(BigInt(nav) * 1_000_000n) })),
    useSessionReceipt: true,
  },
  {
    id: 3,
    title: "Flow #3 — Policy Firewall Breach Test",
    desc: "15,000 sUSDC → Blocked by G2 Spend Cap",
    prompt: "Deposit 15000 sUSDC for 30 days, maximum yield",
    deposit: 15000,
    horizon: 30,
    risk: 90,
    useSessionReceipt: true,
  },
  {
    id: 4,
    title: "Flow #4 — Harbor Vault Outage Failover",
    desc: "Isolate Fault → Route to Healthy RWA",
    prompt: "Deposit 1000 sUSDC for 30 days, conservative",
    deposit: 1000,
    horizon: 30,
    risk: 25,
    outageDrill: ["harbor"],
    useSessionReceipt: true,
  },
]

function CopilotInner() {
  const { system, refresh } = useDashboard()
  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()

  const [prompt, setPrompt] = useState(FLOWS[0].prompt)
  const [deposit, setDeposit] = useState(2500)
  const [horizon, setHorizon] = useState(30)
  const [risk, setRisk] = useState(60)
  const [x402AuditEnabled, setX402AuditEnabled] = useState(true)
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<AgentOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [txStatus, setTxStatus] = useState<string>("")
  const [txHashes, setTxHashes] = useState<Array<{ label: string; hash: string }>>([])

  interface FlowOptions {
    prompt: string
    deposit: number
    horizon: number
    risk: number
    trendObservations?: Array<{ vaultId: string; navMicro: string }>
    outageDrill?: string[]
    skipX402?: boolean
    useSessionReceipt?: boolean
    /** false = suppress the signing drawer auto-open (auto-load run) */
    openDrawer?: boolean
  }

  async function executeFlow(flow: FlowOptions) {
    // the LIVE x402 payment handshake needs the user's wallet signature; the
    // session-receipt and skip modes never move funds and run wallet-less
    if (!flow.skipX402 && !flow.useSessionReceipt && !address) {
      setError("Connect your wallet first — use the Connect Wallet button in the sidebar.")
      return
    }
    setRunning(true)
    setError(null)
    setOutcome(null)
    setTxHashes([])
    const signer = address as `0x${string}`
    try {
      const overrides = { amount: (BigInt(flow.deposit) * 1_000_000n).toString(), horizonDays: flow.horizon, riskCeiling: flow.risk }
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: flow.prompt,
          userAddress: address ?? REVIEWER_ADDRESS,
          overrides,
          trendObservations: flow.trendObservations,
          outageDrill: flow.outageDrill,
          skipX402: flow.skipX402,
          useSessionReceipt: flow.useSessionReceipt,
        }),
      })
      let data = (await res.json()) as AgentOutcome & { error?: string }
      // server-side validation/orchestrator errors never render as an outcome card
      if (!res.ok || data.error) {
        setError(data.error ?? `pipeline failed: HTTP ${res.status}`)
        return
      }
      setOutcome(data)
      if (data.status === "payment_required") {
        const vaultKey = guessVaultKey(flow.prompt)
        const step1 = await fetch(`/api/x402/attestation?vault=${vaultKey}`)
        const challenge = parseChallengeHeader(step1.headers.get("x-payment-required"))
        if (step1.status !== 402 || !challenge) throw new Error(`expected x402 402 challenge, got ${step1.status}`)
        const now = Math.floor(Date.now() / 1000)
        const signature = await signTypedDataAsync({
          domain: { name: "SentinelUSD", version: "1", chainId: 688689, verifyingContract: challenge.asset as `0x${string}` },
          types: {
            TransferWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          primaryType: "TransferWithAuthorization",
          message: {
            from: signer,
            to: challenge.recipient as `0x${string}`,
            value: BigInt(challenge.price),
            validAfter: BigInt(now - 60),
            validBefore: BigInt(Math.min(challenge.expiry, now + 600)),
            nonce: challenge.nonce as `0x${string}`,
          },
        })
        const idempotencyKey = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        const step2 = await fetch(`/api/x402/attestation?vault=${vaultKey}`, {
          headers: {
            "x-payment": JSON.stringify({
              scheme: "exact",
              payload: { from: signer, signature, validAfter: String(now - 60), validBefore: String(Math.min(challenge.expiry, now + 600)), nonce: challenge.nonce },
              idempotencyKey,
              challengeNonce: challenge.nonce,
            }),
            "x-idempotency-key": idempotencyKey,
          },
        })
        if (step2.status !== 200) throw new Error(`x402 paid replay failed: ${step2.status}`)
        const paid = await step2.json()
        // resume the pipeline with the bound receipt hash
        const res2 = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: flow.prompt,
            userAddress: signer,
            overrides,
            x402SignedPayment: { vaultKey, idempotencyKey, receiptHash: paid.receiptHash, attestation: paid.attestation },
          }),
        })
        data = (await res2.json()) as AgentOutcome
        setOutcome(data)
      }

      if (data.status === "prepared" && !flow.skipX402 && flow.openDrawer !== false) setDrawerOpen(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  async function runPipeline() {
    await executeFlow({
      prompt,
      deposit,
      horizon,
      risk,
      // audit disabled explicitly → skipX402 → G4 MissingX402AuditAttestation
      skipX402: !x402AuditEnabled,
      // audit enabled: connected wallets run the LIVE 402 handshake; reviewers
      // without a wallet run the session-receipt path (0 fee, no payment)
      useSessionReceipt: x402AuditEnabled ? !isConnected : false,
    })
  }

  /** 1-click flow: fills the intent controls, then runs the pipeline */
  function applyFlow(flowId: number) {
    const f = FLOWS.find((x) => x.id === flowId)
    if (!f) return
    setPrompt(f.prompt)
    setDeposit(f.deposit)
    setHorizon(f.horizon)
    setRisk(f.risk)
    void executeFlow({ prompt: f.prompt, deposit: f.deposit, horizon: f.horizon, risk: f.risk, trendObservations: f.trendObservations, outageDrill: f.outageDrill, skipX402: f.skipX402, useSessionReceipt: f.useSessionReceipt })
  }

  // auto-load the latest pipeline execution result + routing rationale on
  // first paint (reviewer session run — routes with the cached x402 session
  // receipt; no wallet signature required, no fee moves)
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    autoRan.current = true
    const f = FLOWS[0]
    void executeFlow({ prompt: f.prompt, deposit: f.deposit, horizon: f.horizon, risk: f.risk, useSessionReceipt: true, openDrawer: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signBundle() {
    if (!outcome?.bundle || !address) return
    setTxStatus("")
    setTxHashes([])
    await signBundleWithWagmi()
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 bg-lime pulse-live" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Agent Intent Copilot</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Intent Copilot & 1-Click Reviewer Flows</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1">
          Describe an allocation in plain English — the Sentinel agent runs Chain MCP → Docs MCP → x402 audit → SkillEngine, then hands YOU the keys.
        </p>
      </div>

      {/* NL prompt bar */}
      <div className="bg-card border border-border p-4 md:p-6 mb-4 md:mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-lime" />
          <span className="text-sm font-medium">Natural-Language Intent</span>
        </div>
        <div className="flex flex-col md:flex-row gap-3">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Deposit 2,500 sUSDC for 30 days, moderate risk — run due diligence first"
            className="flex-1 font-mono text-sm"
          />
          <Button onClick={() => void runPipeline()} disabled={running || !prompt} className="gap-2 bg-lime text-background hover:bg-lime/90 font-medium">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Workflow className="w-4 h-4" />}
            {running ? "Pipeline running…" : "Run 4-Tool Pipeline"}
          </Button>
        </div>
        {/* explicit x402 audit toggle — disabling it is the G4 breach demo */}
        <label className="mt-3 inline-flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={x402AuditEnabled}
            onChange={(e) => setX402AuditEnabled(e.target.checked)}
            className="w-3.5 h-3.5 accent-lime"
          />
          x402 paid oracle audit ({x402AuditEnabled ? "REQUIRED — G4 enforces the attestation receipt" : "DISABLED — allocation requests will be blocked by G4"})
        </label>
        {/* 1-Click Reviewer Verification Flows */}
        <div className="mt-5">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">1-Click Reviewer Verification Flows</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FLOWS.map((f) => (
              <button
                key={f.id}
                onClick={() => applyFlow(f.id)}
                disabled={running}
                className={cn(
                  "text-left p-4 bg-surface border border-border hover:border-lime/50 hover:bg-surface-hover transition-all group",
                  running && "opacity-50 pointer-events-none",
                )}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-1.5 h-1.5 bg-lime pulse-live" />
                  <span className="text-sm font-medium group-hover:text-lime transition-colors">{f.title}</span>
                </div>
                <p className="text-xs font-mono text-muted-foreground">{f.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Structured sliders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium flex items-center gap-2"><CircleDollarSign className="w-4 h-4 text-lime" /> Deposit Size</span>
            <span className="text-sm font-mono">{deposit.toLocaleString()} sUSDC</span>
          </div>
          <Slider value={[deposit]} min={100} max={10000} step={100} onValueChange={(v) => setDeposit(v[0])} />
          <p className="text-xs text-muted-foreground font-mono mt-3">policy cap 5,000 sUSDC / tx (on-chain)</p>
        </div>
        <div className="bg-card border border-border p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium flex items-center gap-2"><Cpu className="w-4 h-4 text-lime" /> Holding Horizon</span>
            <span className="text-sm font-mono">{horizon} days</span>
          </div>
          <Slider value={[horizon]} min={1} max={365} step={1} onValueChange={(v) => setHorizon(v[0])} />
          <p className="text-xs text-muted-foreground font-mono mt-3">HorizonNetYieldRouter uses exact bigint math</p>
        </div>
        <div className="bg-card border border-border p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-lime" /> Risk Ceiling</span>
            <span className="text-sm font-mono">{risk} / 100</span>
          </div>
          <Slider value={[risk]} min={0} max={100} step={5} onValueChange={(v) => setRisk(v[0])} />
          <p className="text-xs text-muted-foreground font-mono mt-3">venues above your ceiling are excluded (fail-closed)</p>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 p-4 mb-6 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <span className="text-sm text-destructive font-mono">{error}</span>
        </div>
      )}

      {/* Pipeline telemetry */}
      {outcome && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
          <div className="bg-card border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-medium">4-Tool Execution Pipeline — Latest Result</h2>
              <Badge variant="outline" className="font-mono text-xs">{outcome.status}</Badge>
            </div>
            <p className="px-4 pt-3 text-[11px] font-mono text-muted-foreground">
              auto-loaded on page open (reviewer session run · cached x402 session receipt · 0 fee · signing still requires YOUR wallet)
            </p>
            <div className="divide-y divide-border">
              {(outcome.pipeline ?? []).map((step, i) => (
                <div key={i} className="p-3 md:p-4 flex items-start gap-3">
                  <div className={cn("w-6 h-6 flex items-center justify-center shrink-0 text-xs font-mono border", step.ok ? "bg-lime/20 text-lime border-lime/30" : "bg-destructive/20 text-destructive border-destructive/30")}>
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {step.tool}
                      <span className="text-xs font-mono text-muted-foreground">{step.latencyMs}ms</span>
                    </p>
                    <p className="text-xs font-mono text-muted-foreground">{step.call}</p>
                    <p className="text-xs mt-1">{step.summary}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Outcome card */}
          <div className="bg-card border border-border p-4 md:p-6">
            {outcome.status === "prepared" && outcome.bundle && (
              <>
                <h2 className="text-sm font-medium flex items-center gap-2 mb-3"><CheckCircle2 className="w-4 h-4 text-lime" /> Prepared Action Bundle (Non-Custodial)</h2>
                <p className="text-sm mb-4">{outcome.bundle.description}</p>
                <dl className="space-y-2 font-mono text-xs">
                  <Row k="to" v={outcome.bundle.to} />
                  <Row k="data" v={`${outcome.bundle.data.slice(0, 42)}…`} />
                  <Row k="value" v={outcome.bundle.value} />
                  <Row k="chainId" v={String(outcome.bundle.chainId)} />
                  <Row k="x402ReceiptHash" v={`${outcome.bundle.x402ReceiptHash.slice(0, 26)}…`} />
                  <Row k="agentIntentDigest" v={`${outcome.bundle.agentIntentDigest.slice(0, 26)}…`} />
                </dl>
                <div className="flex flex-wrap gap-2 mt-3">
                  {(outcome.bundle?.policyCheckReport?.outcomes ?? []).map((o) => (
                    <Badge key={o.guard} variant="outline" className={cn("font-mono text-[10px]", o.passed ? "text-lime border-lime/30" : "text-destructive border-destructive/30")}>
                      {o.guard} {o.passed ? "PASS" : "FAIL"}
                    </Badge>
                  ))}
                </div>
                {outcome.routing?.winner && (
                  <p className="text-xs font-mono text-muted-foreground mt-3">
                    routing: {outcome.routing.winner.label} · net {outcome.routing.winner.breakdown.netReturn} micro-sUSDC · netAPY {Number(outcome.routing.winner.breakdown.netApyBps) / 100}%
                  </p>
                )}
                <Button className="w-full mt-4 gap-2 bg-lime text-background hover:bg-lime/90" onClick={() => setDrawerOpen(true)}>
                  <Wallet className="w-4 h-4" /> Open Signing Drawer
                </Button>
              </>
            )}
            {outcome.status === "blocked" && outcome.blocked && (
              <>
                <h2 className="text-sm font-medium flex items-center gap-2 mb-3"><ShieldX className="w-4 h-4 text-destructive" /> Blocked by Policy Firewall</h2>
                <p className="text-sm text-destructive mb-4">{outcome.blocked.reason}</p>
                <div className="space-y-2">
                  {(outcome.blocked?.failingGuards ?? []).map((g, i) => (
                    <div key={i} className="p-3 bg-destructive/10 border border-destructive/30">
                      <p className="text-xs font-mono text-destructive">{g.customError}</p>
                      <p className="text-xs mt-1">{g.detail}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-4">0 funds authorized · user can still sign nothing</p>
              </>
            )}
            {outcome.status === "advisory" && outcome.advisory && (
              <>
                <h2 className="text-sm font-medium flex items-center gap-2 mb-3"><FileCheck2 className="w-4 h-4 text-lime" /> Advisory (no funds moved)</h2>
                <p className="text-sm">{outcome.advisory.summary}</p>
                {outcome.routing?.winner && (
                  <p className="text-xs font-mono text-muted-foreground mt-3">
                    winner: {outcome.routing.winner.label} · net {outcome.routing.winner.breakdown.netReturn} micro-sUSDC · netAPY {Number(outcome.routing.winner.breakdown.netApyBps) / 100}%
                  </p>
                )}
              </>
            )}
            {outcome.status === "payment_required" && (
              <>
                <h2 className="text-sm font-medium flex items-center gap-2 mb-3"><CircleDollarSign className="w-4 h-4 text-chart-2" /> x402 Payment In Flight</h2>
                <p className="text-sm">Complete the wallet signature above — the agent resumes automatically with your signed EIP-3009 authorization.</p>
              </>
            )}
          </div>
        </div>
      )}

      <SigningDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        bundle={outcome?.bundle}
        txStatus={txStatus}
        txHashes={txHashes}
        onSign={() => void signBundleWithWagmi()}
      />

      {!isConnected && (
        <p className="text-xs text-muted-foreground font-mono">
          note: connect a wallet (Settings) to sign bundles — the agent itself never holds keys.
        </p>
      )}
    </div>
  )

  /* ------------------------------------------------------------------ */

  async function signBundleWithWagmi() {
    const bundle = outcome?.bundle
    if (!bundle || !address) return
    try {
      for (const approval of bundle.approvals) {
        setTxStatus(approval.summary)
        const hash = await writeContractAsync({
          account: address,
          chain: pharosAtlanticChain,
          address: approval.to as `0x${string}`,
          abi: [{ type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }],
          functionName: "approve",
          args: [bundle.to as `0x${string}`, BigInt(deposit) * 1_000_000n],
        })
        setTxHashes((prev) => [...prev, { label: "approve(sUSDC→firewall)", hash }])
      }
      setTxStatus("Signing SentinelPolicyFirewall.executeGuardedAllocation…")
      const hash = await writeContractAsync({
        account: address,
        chain: pharosAtlanticChain,
        address: bundle.to as `0x${string}`,
        abi: [{
          type: "function",
          name: "executeGuardedAllocation",
          inputs: [
            { name: "vault", type: "address" }, { name: "amount", type: "uint256" }, { name: "minSharesOut", type: "uint256" },
            { name: "x402ReceiptHash", type: "bytes32" }, { name: "agentIntentDigest", type: "bytes32" },
          ],
          outputs: [{ type: "uint256" }],
          stateMutability: "nonpayable",
        }],
        functionName: "executeGuardedAllocation",
        args: [parseVaultFromData(bundle.data), BigInt(deposit) * 1_000_000n, BigInt(bundle.minSharesOut), bundle.x402ReceiptHash as `0x${string}`, bundle.agentIntentDigest as `0x${string}`],
      })
      setTxHashes((prev) => [...prev, { label: "executeGuardedAllocation", hash }])
      setTxStatus("Executed! Receipts below — verify on PharosScan.")
      void refresh()
    } catch (e) {
      setTxStatus(`Signing failed / rejected: ${String(e).slice(0, 140)}`)
    }
  }
}

function parseVaultFromData(data: string): `0x${string}` {
  // executeGuardedAllocation args start after selector (4 bytes); first arg is
  // address padded to 32 bytes: bytes 8..72 hex chars.
  return `0x${data.slice(10, 10 + 64).slice(24)}` as `0x${string}`
}

function guessVaultKey(prompt: string): string {
  const p = prompt.toLowerCase()
  if (/\b(t[- ]?bill|treasury)\b/.test(p)) return "tbill"
  if (/\b(harbor|buffer)\b/.test(p)) return "harbor"
  return "credit"
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="truncate flex-1" title={v}>{v}</dd>
    </div>
  )
}

function SigningDrawer({ open, onOpenChange, bundle, txStatus, txHashes, onSign }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  bundle?: Bundle
  txStatus: string
  txHashes: Array<{ label: string; hash: string }>
  onSign: () => void
}) {
  const { system } = useDashboard()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-card border-l border-border p-6">
        <SheetHeader className="p-0 mb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <Wallet className="w-4 h-4 text-lime" /> Non-Custodial Signing Drawer
          </SheetTitle>
        </SheetHeader>
        {!bundle && <p className="text-sm text-muted-foreground">Run the pipeline first.</p>}
        {bundle && (
          <div className="space-y-4">
            <p className="text-sm">{bundle.description}</p>
            <div className="bg-surface border border-border p-3 font-mono text-xs space-y-2">
              <p className="text-muted-foreground">RAW CALLDATA (you sign, the agent cannot):</p>
              <p className="break-all">to: {bundle.to}</p>
              <p className="break-all text-lime">data: {bundle.data}</p>
              <p>value: {bundle.value} · chainId: {bundle.chainId}</p>
              <p className="break-all">intentDigest: {bundle.agentIntentDigest}</p>
              <p className="break-all">x402ReceiptHash: {bundle.x402ReceiptHash}</p>
            </div>
            <Button className="w-full bg-lime text-background hover:bg-lime/90 gap-2" onClick={onSign}>
              <ArrowRight className="w-4 h-4" /> Sign with Connected Wallet
            </Button>
            {txStatus && <p className="text-xs font-mono text-muted-foreground">{txStatus}</p>}
            {txHashes.map((t, i) => (
              <a key={i} href={`${system?.network.explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs font-mono text-lime hover:underline">
                <ExternalLink className="w-3 h-3" /> {t.label}: {t.hash.slice(0, 22)}…
              </a>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default function CopilotPage() {
  return (
    <DashboardLayout>
      <CopilotInner />
    </DashboardLayout>
  )
}
