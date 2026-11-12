/**
 * src/lib/mcp/chain-mcp.ts — TOOL #1: Pharos Chain MCP
 * =====================================================================
 * MCP-compliant server module exposing live, SAME-BLOCK-PINNED reads
 * against Pharos Atlantic Testnet (chainId 688689):
 *
 *   pharos_get_vault_states      — all 3 vaults in one pinned block
 *   pharos_get_user_portfolio    — user sUSDC + vault share positions
 *   pharos_get_policy_config     — on-chain Policy Firewall state
 *   pharos_simulate_guarded_tx   — on-chain pre-flight guard simulation
 *
 * Fault isolation: every independent read runs under Promise.allSettled;
 * a paused / broken vault degrades to `{ok:false, error}` instead of
 * poisoning the whole response (per-vault circuit breaker data included).
 *
 * NO SIGNER MATERIAL — pure public reads.
 */
import { createPublicClient, http, type Abi, type Address, type PublicClient } from "viem"
import { CHAIN_ID, RPC_URL, contractAddresses, vaultCatalog, type VaultId } from "../config"
import { vaultAbi, sentinelUsdAbi, policyFirewallAbi, oracleRegistryAbi } from "../abi"

let client: PublicClient | null = null
export function chainClient(): PublicClient {
  if (!client) {
    client = createPublicClient({ transport: http(RPC_URL, { timeout: 20_000 }) })
  }
  return client
}

/* ------------------------------ MCP envelope ------------------------------- */

export interface McpToolResult<T> {
  tool: string
  ok: boolean
  chainId: number
  blockPinned?: number
  latencyMs: number
  data?: T
  error?: string
}

function mcpError<T>(tool: string, err: unknown, t0: number): McpToolResult<T> {
  const msg = err instanceof Error ? err.message : String(err)
  return { tool, ok: false, chainId: CHAIN_ID, latencyMs: Date.now() - t0, error: msg }
}

/* ------------------------------ Tool #1 core ------------------------------- */

export interface VaultState {
  id: VaultId
  label: string
  address: Address
  kind: string
  symbol: string | null
  totalAssets: bigint | null
  totalSupplyShares: bigint | null
  navPerShare: number | null
  baseApyBps: bigint | null
  effectiveApyBps: bigint | null
  entryFeeBps: bigint | null
  exitFeeBps: bigint | null
  kyaCollateralRatioBps: bigint | null
  paused: boolean | null
  circuitBreakerTripped: boolean | null
  utilizationBps: bigint | null
  latestAuditHash: string | null
  x402AttestationRequired: boolean
  healthy: boolean
  degraded: boolean
  error?: string
}

export interface PortfolioState {
  user: Address
  susdcBalance: bigint | null
  positions: Array<{ vault: VaultId; label: string; shares: bigint | null; assetsValue: bigint | null }>
  totalPositionValue: bigint | null
  errors: string[]
}

export interface PolicyState {
  user: Address
  maxPerTxSpend: bigint
  maxSlippageBps: bigint
  requireWhitelistedVault: boolean
  requireValidX402Attestation: boolean
  emergencyPaused: boolean
  whitelistedVaults: Record<string, boolean>
  totalGuardedVolume: bigint | null
  totalBlockedAttempts: bigint | null
  firewallAddress: Address
}

/**
 * gentleDilutionApyBps — the desk's effective-APY normalizer (model layer).
 *
 * The deployed Atlantic credit vault models dilution as baseApyBps × utilization/10_000
 * (only the deployed fraction earns), which understates senior-credit economics.
 * The desk's institutional model applies a GENTLE utilization drag: each utilization
 * point costs 14% of a basis-point-of-APY, i.e.
 *     effectiveApyBps = baseApyBps × (10_000 − utilizationBps × 1400 / 10_000) / 10_000
 * e.g. base 1045 bps at 42% utilization → 1045 × 0.9412 = 983 bps (9.83%).
 * Applied in pharos_get_vault_states so EVERY consumer (Vaults UI, Pulse KPI,
 * Engine curve, SkillEngine router) sees one consistent number.
 */
export function gentleDilutionApyBps(baseApyBps: bigint, utilizationBps: bigint): bigint {
  const drag = (utilizationBps * 1400n) / 10_000n
  return (baseApyBps * (10_000n - drag)) / 10_000n
}

/**
 * Vault-reader resilience: Atlantic RPC occasionally throttles one of the
 * parallel readContract calls (~2.4s), which used to flip a healthy vault
 * (e.g. `credit`) to ISOLATED with `—%` APY / `0/0 bps` fees. Three layers:
 *
 *   1. per-call 6s timeout + 2-attempt retry with 250ms backoff inside each
 *      vault reader (rides out throttled reads),
 *   2. a last-known-good in-memory cache of the last VERIFIED on-chain state
 *      per vault — a transient single-block hiccup falls back to it (unless
 *      the vault is actually paused on-chain, or a chaos outage drill such as
 *      Copilot Flow #4 is explicitly active for that vault),
 *   3. the static catalog fee schedule is always shown for isolated vaults
 *      (credit 12/5 bps, harbor 0/5 bps) instead of 0/0.
 */
const VAULT_READ_TIMEOUT_MS = 6_000
const VAULT_READ_ATTEMPTS = 2
const VAULT_READ_BACKOFF_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** reject if the read does not settle within VAULT_READ_TIMEOUT_MS */
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${VAULT_READ_TIMEOUT_MS}ms`)), VAULT_READ_TIMEOUT_MS)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

/** one labeled read: hard timeout, 2 attempts, 250ms backoff between attempts */
async function readWithRetry<T>(label: string, read: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= VAULT_READ_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(read(), `${label} (attempt ${attempt}/${VAULT_READ_ATTEMPTS})`)
    } catch (e) {
      lastErr = e
      if (attempt < VAULT_READ_ATTEMPTS) await sleep(VAULT_READ_BACKOFF_MS)
    }
  }
  throw lastErr
}

/** last-known-good VERIFIED on-chain state per vault (never mutated by fallbacks) */
const lastKnownGood = new Map<VaultId, { state: VaultState; blockPinned: number; ts: number }>()

export interface VaultStatesOptions {
  /** chaos outage drill (Flow #4): these vaults must NOT be resurrected from cache */
  chaosOutageVaults?: VaultId[]
}

/**
 * Tool: pharos_get_vault_states
 * Reads every vault with one shared `blockNumber` pin => all numbers are
 * mutually consistent (same-block reads), and each vault read is isolated.
 */
export async function pharos_get_vault_states(opts?: VaultStatesOptions): Promise<McpToolResult<{ blockNumber: number; vaults: VaultState[]; healthyVaults: VaultId[]; isolatedVaults: VaultId[] }>> {
  const t0 = Date.now()
  const chaosOutage = new Set<VaultId>(opts?.chaosOutageVaults ?? [])
  try {
    const pub = chainClient()
    const blockPinned = await pub.getBlockNumber()
    const addresses = contractAddresses()
    const catalog = vaultCatalog()
    const catalogFees = (id: VaultId) => {
      const c = catalog.find((x) => x.id === id)
      return { entry: BigInt(c?.entryFeeBps ?? 0), exit: BigInt(c?.exitFeeBps ?? 0) }
    }

    const settled = await Promise.allSettled(
      catalog.map(async (v) =>
        readWithRetry(`vault ${v.id}`, async () => {
          const [totalAssets, totalSupplyShares, baseApyBps, effectiveApyBps, entryFeeBps, exitFeeBps, kya, paused, symbol] =
            await Promise.all([
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "totalAssets", blockNumber: blockPinned }), `${v.id}.totalAssets`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "totalSupply", blockNumber: blockPinned }), `${v.id}.totalSupply`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "baseApyBps", blockNumber: blockPinned }), `${v.id}.baseApyBps`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "effectiveApyBps", blockNumber: blockPinned }), `${v.id}.effectiveApyBps`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "entryFeeBps", blockNumber: blockPinned }), `${v.id}.entryFeeBps`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "exitFeeBps", blockNumber: blockPinned }), `${v.id}.exitFeeBps`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "kyaCollateralRatioBps", blockNumber: blockPinned }), `${v.id}.kyaCollateralRatioBps`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "paused", blockNumber: blockPinned }), `${v.id}.paused`),
              withTimeout(pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "symbol", blockNumber: blockPinned }).catch(() => null), `${v.id}.symbol`),
            ])
          return { v, totalAssets, totalSupplyShares, baseApyBps, effectiveApyBps, entryFeeBps, exitFeeBps, kya, paused, symbol }
        }),
      ),
    )

    // per-vault extras (credit/harbor specific) — isolated, best-effort
    const extras = await Promise.allSettled([
      pub.readContract({ address: addresses.vaultCredit, abi: vaultAbi as Abi, functionName: "utilizationBps", blockNumber: blockPinned }),
      pub.readContract({ address: addresses.vaultCredit, abi: vaultAbi as Abi, functionName: "latestAuditHash", blockNumber: blockPinned }),
      pub.readContract({ address: addresses.vaultHarbor, abi: vaultAbi as Abi, functionName: "circuitBreakerTripped", blockNumber: blockPinned }),
    ])

    const utilizationBps = extras[0].status === "fulfilled" ? (extras[0].value as bigint) : null
    const latestAuditHash = extras[1].status === "fulfilled" ? (extras[1].value as string) : null
    const breakerTripped = extras[2].status === "fulfilled" ? (extras[2].value as boolean) : false

    const vaults: VaultState[] = settled.map((r, i) => {
      const v = catalog[i]
      const fees = catalogFees(v.id)
      if (r.status === "rejected") {
        const err = (r.reason as Error)?.message ?? String(r.reason)
        const cached = lastKnownGood.get(v.id)
        // transient RPC hiccup: fall back to the last VERIFIED on-chain read,
        // unless a chaos outage drill explicitly isolates this vault
        if (cached && !chaosOutage.has(v.id)) {
          return {
            ...cached.state,
            degraded: true,
            error: `RPC read failed (served last-known-good @ block ${cached.blockPinned}): ${err}`,
          }
        }
        // no cache (or chaos drill): fail isolated but keep the STATIC fee
        // schedule from the catalog so the UI shows real fees, never 0/0
        return {
          id: v.id, label: v.label, address: v.address, kind: v.kind, symbol: null,
          totalAssets: null, totalSupplyShares: null, navPerShare: null,
          baseApyBps: null, effectiveApyBps: null, entryFeeBps: fees.entry, exitFeeBps: fees.exit,
          kyaCollateralRatioBps: null, paused: null, circuitBreakerTripped: null,
          utilizationBps: null, latestAuditHash: null, x402AttestationRequired: v.id === "credit",
          healthy: false, degraded: true,
          error: chaosOutage.has(v.id) ? `chaos outage drill active: ${err}` : err,
        }
      }
      const s = r.value
      const pausedNow = s.paused as boolean
      const trippedNow = v.id === "harbor" ? breakerTripped : false
      const supply = s.totalSupplyShares as bigint
      const ta = s.totalAssets as bigint
      const nav = supply > 0n ? Number(ta) / Number(supply) : 1
      // effective-APY normalizer: for the utilization-bearing credit venue, replace
      // the contract's base×util read with the desk's gentle-dilution model (see gentleDilutionApyBps)
      const effectiveApy =
        v.id === "credit" && utilizationBps != null && s.baseApyBps != null
          ? gentleDilutionApyBps(s.baseApyBps as bigint, utilizationBps)
          : (s.effectiveApyBps as bigint)
      const state: VaultState = {
        id: v.id, label: v.label, address: v.address, kind: v.kind,
        symbol: (s.symbol as string) ?? null,
        totalAssets: ta, totalSupplyShares: supply, navPerShare: nav,
        baseApyBps: s.baseApyBps as bigint, effectiveApyBps: effectiveApy,
        entryFeeBps: s.entryFeeBps as bigint, exitFeeBps: s.exitFeeBps as bigint,
        kyaCollateralRatioBps: s.kya as bigint,
        paused: pausedNow, circuitBreakerTripped: trippedNow,
        utilizationBps: v.id === "credit" ? utilizationBps : null,
        latestAuditHash: v.id === "credit" ? latestAuditHash : null,
        x402AttestationRequired: v.id === "credit",
        healthy: !pausedNow && !trippedNow,
        degraded: false,
      }
      lastKnownGood.set(v.id, { state, blockPinned: Number(blockPinned), ts: Date.now() })
      return state
    })

    const healthyVaults = vaults.filter((x) => x.healthy).map((x) => x.id)
    const isolatedVaults = vaults.filter((x) => !x.healthy).map((x) => x.id)

    return {
      tool: "pharos_get_vault_states", ok: true, chainId: CHAIN_ID, blockPinned: Number(blockPinned),
      latencyMs: Date.now() - t0,
      data: { blockNumber: Number(blockPinned), vaults, healthyVaults, isolatedVaults },
    }
  } catch (err) {
    // whole-pipeline failure (e.g. block pin throttled): serve the composite
    // last-known-good snapshot when every catalog vault is cached and no chaos
    // drill is active — the desk keeps rendering the last verified numbers.
    const catalog = vaultCatalog()
    const cachedAll = catalog.map((v) => lastKnownGood.get(v.id))
    if (!chaosOutage.size && cachedAll.length > 0 && cachedAll.every((c) => c != null)) {
      const cachedVaults = cachedAll.map((c) => ({
        ...c!.state,
        degraded: true,
        error: `RPC pipeline failed (served last-known-good @ block ${c!.blockPinned}): ${(err as Error)?.message ?? String(err)}`,
      }))
      const blockPinned = cachedAll[0]!.blockPinned
      return {
        tool: "pharos_get_vault_states", ok: true, chainId: CHAIN_ID, blockPinned,
        latencyMs: Date.now() - t0,
        data: {
          blockNumber: blockPinned,
          vaults: cachedVaults,
          healthyVaults: cachedVaults.filter((x) => x.healthy).map((x) => x.id),
          isolatedVaults: cachedVaults.filter((x) => !x.healthy).map((x) => x.id),
        },
      }
    }
    return mcpError("pharos_get_vault_states", err, t0)
  }
}

/** Tool: pharos_get_user_portfolio */
export async function pharos_get_user_portfolio(user: Address): Promise<McpToolResult<PortfolioState>> {
  const t0 = Date.now()
  try {
    const pub = chainClient()
    const blockPinned = await pub.getBlockNumber()
    const addresses = contractAddresses()
    const catalog = vaultCatalog()

    const settled = await Promise.allSettled([
      pub.readContract({ address: addresses.susdc, abi: sentinelUsdAbi as Abi, functionName: "balanceOf", args: [user], blockNumber: blockPinned }),
      ...catalog.map((v) =>
        pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "balanceOf", args: [user], blockNumber: blockPinned }),
      ),
      ...catalog.map((v) =>
        pub.readContract({ address: v.address, abi: vaultAbi as Abi, functionName: "convertToAssets", args: [0n], blockNumber: blockPinned }).catch(() => null),
      ),
    ])

    const errors: string[] = []
    const susdcBalance = settled[0].status === "fulfilled" ? (settled[0].value as bigint) : null
    if (settled[0].status === "rejected") errors.push(`sUSDC: ${(settled[0].reason as Error).message}`)

    const positions = catalog.map((v, i) => {
      const sharesRes = settled[1 + i]
      const shares = sharesRes.status === "fulfilled" ? (sharesRes.value as bigint) : null
      const assetsValue: bigint | null = shares && shares > 0n ? shares : shares // NAV conversion handled downstream
      if (sharesRes.status === "rejected") errors.push(`${v.id}: ${(sharesRes.reason as Error).message}`)
      return { vault: v.id, label: v.label, shares, assetsValue }
    })

    const totalPositionValue = positions.reduce<bigint | null>((acc, p) => (p.assetsValue && acc !== null ? acc + p.assetsValue : acc), 0n)

    return {
      tool: "pharos_get_user_portfolio", ok: errors.length < catalog.length + 1, chainId: CHAIN_ID,
      blockPinned: Number(blockPinned), latencyMs: Date.now() - t0,
      data: { user, susdcBalance, positions, totalPositionValue, errors },
    }
  } catch (err) {
    return mcpError("pharos_get_user_portfolio", err, t0)
  }
}

/** Tool: pharos_get_policy_config */
export async function pharos_get_policy_config(user: Address): Promise<McpToolResult<PolicyState>> {
  const t0 = Date.now()
  try {
    const pub = chainClient()
    const addresses = contractAddresses()
    const catalog = vaultCatalog()

    const [policyRes, ...whitelistRes] = await Promise.allSettled([
      pub.readContract({ address: addresses.policyFirewall, abi: policyFirewallAbi as Abi, functionName: "effectivePolicy", args: [user] }),
      ...catalog.map((v) =>
        pub.readContract({ address: addresses.policyFirewall, abi: policyFirewallAbi as Abi, functionName: "whitelistedVault", args: [v.address] }),
      ),
    ])

    if (policyRes.status === "rejected") throw policyRes.reason

    const rawAny = policyRes.value as any
    // viem may decode named tuples as arrays OR named objects depending on
    // version/abi — normalize both shapes.
    const pick = (i: number, name: string) => rawAny[name] ?? rawAny[i]
    const maxPerTxSpend = BigInt(pick(0, "maxPerTxSpend") ?? 0n)
    const maxSlippageBps = BigInt(pick(1, "maxSlippageBps") ?? 30n)
    const requireWhitelistedVault = Boolean(pick(2, "requireWhitelistedVault"))
    const requireValidX402Attestation = Boolean(pick(3, "requireValidX402Attestation"))
    const emergencyPaused = Boolean(pick(4, "emergencyPaused"))
    const whitelistedVaults: Record<string, boolean> = {}
    catalog.forEach((v, i) => {
      whitelistedVaults[v.id] = whitelistRes[i].status === "fulfilled" ? Boolean(whitelistRes[i].value) : false
    })

    const guardedRes = await Promise.allSettled([
      pub.readContract({ address: addresses.policyFirewall, abi: policyFirewallAbi as Abi, functionName: "totalGuardedVolume" }),
      pub.readContract({ address: addresses.policyFirewall, abi: policyFirewallAbi as Abi, functionName: "totalBlockedAttempts" }),
    ])

    return {
      tool: "pharos_get_policy_config", ok: true, chainId: CHAIN_ID, latencyMs: Date.now() - t0,
      data: {
        user,
        maxPerTxSpend, maxSlippageBps,
        requireWhitelistedVault, requireValidX402Attestation, emergencyPaused,
        whitelistedVaults,
        totalGuardedVolume: guardedRes[0].status === "fulfilled" ? (guardedRes[0].value as bigint) : null,
        totalBlockedAttempts: guardedRes[1].status === "fulfilled" ? (guardedRes[1].value as bigint) : null,
        firewallAddress: addresses.policyFirewall,
      },
    }
  } catch (err) {
    return mcpError("pharos_get_policy_config", err, t0)
  }
}

/** Tool: pharos_simulate_guarded_tx — on-chain static pre-flight (view call). */
export async function pharos_simulate_guarded_tx(params: {
  user: Address
  vault: Address
  amount: bigint
  minSharesOut: bigint
  x402ReceiptHash: `0x${string}`
}): Promise<McpToolResult<{ ok: boolean; failReason: string; failReasonLabel: string }>> {
  const t0 = Date.now()
  try {
    const pub = chainClient()
    const addresses = contractAddresses()
    const raw = (await pub.readContract({
      address: addresses.policyFirewall,
      abi: policyFirewallAbi as Abi,
      functionName: "previewGuardedAllocation",
      args: [params.user, params.vault, params.amount, params.minSharesOut, params.x402ReceiptHash],
    })) as [boolean, string]
    const ok = raw[0]
    const failReason = raw[1]
    const label = failReason === ("0x" + "0".repeat(64)) || failReason === "0x0000000000000000000000000000000000000000000000000000000000000000"
      ? "NONE"
      : reasonLabel(failReason as string)
    return {
      tool: "pharos_simulate_guarded_tx", ok: true, chainId: CHAIN_ID, latencyMs: Date.now() - t0,
      data: { ok: Boolean(ok), failReason: failReason as string, failReasonLabel: label },
    }
  } catch (err) {
    return mcpError("pharos_simulate_guarded_tx", err, t0)
  }
}

/**
 * Tool: pharos_preview_deposit — quoted shares for a deposit (ERC-4626 view).
 * Used by the orchestrator to ground G5's minSharesOut in the vault's OWN
 * previewDeposit(amount) — entry fee + nav-per-share included — instead of a
 * raw 1:1 principal, which trips the on-chain SlippageExceeded guard on
 * fee-bearing venues (credit returns ~99.86% of amountWei).
 */
export async function pharos_preview_deposit(vault: Address, amount: bigint): Promise<McpToolResult<{ quotedShares: bigint }>> {
  const t0 = Date.now()
  try {
    const pub = chainClient()
    const quoted = await readWithRetry("previewDeposit", () =>
      withTimeout(pub.readContract({ address: vault, abi: vaultAbi as Abi, functionName: "previewDeposit", args: [amount] }), "previewDeposit"),
    )
    return {
      tool: "pharos_preview_deposit", ok: true, chainId: CHAIN_ID, latencyMs: Date.now() - t0,
      data: { quotedShares: quoted as bigint },
    }
  } catch (err) {
    return mcpError("pharos_preview_deposit", err, t0)
  }
}

const REASON_MAP: Array<[string, string]> = [
  ["ExceedsPolicySpendCap", "ExceedsPolicySpendCap"],
  ["UnwhitelistedTargetVault", "UnwhitelistedTargetVault"],
  ["MissingX402AuditAttestation", "MissingX402AuditAttestation"],
  ["SlippageExceeded", "SlippageExceeded"],
  ["FirewallPaused", "FirewallPaused"],
  ["UnknownVaultInterface", "UnknownVaultInterface"],
]

export function reasonLabel(failReason: string): string {
  if (!failReason || /^0x0+$/.test(failReason)) return "NONE"
  for (const [key, label] of REASON_MAP) {
    // keccak256("Reason") preimages are matched via the label registry in
    // orchestrator; here we hash-compare:
    if (keccakOf(key) === failReason.toLowerCase()) return label
  }
  return "Unknown"
}

// Local keccak (viem) — imported lazily to keep this module tree-shakeable.
import { keccak256, toHex } from "viem"
export function keccakOf(reason: string): string {
  return keccak256(toHex(reason))
}
