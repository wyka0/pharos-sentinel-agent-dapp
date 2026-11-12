/**
 * src/lib/skills/horizon-router.ts — Skill B: HorizonNetYieldRouterSkill
 * =====================================================================
 * Computes the EXACT bigint net return of depositing `dx` sUSDC into each
 * vault and holding for `T` days, accounting for:
 *   - gross yield (effectiveApyBps * T / 365d; credit venue arrives
 *     pre-normalized with gentle utilization dilution from Chain MCP)
 *   - entry/exit program fees — modeled as ANNUALIZED RATES amortized
 *     pro-rata over the holding horizon (fee_bps × T / 365). This is the
 *     desk's cross-venue/cross-horizon comparison convention: one-shot
 *     fee schedules would make short-horizon routing degenerate onto the
 *     fee-free venue regardless of yield. On-chain settlement still
 *     charges the contract's actual one-time schedule — executed bundles
 *     remain bounded by previewDeposit + the Policy Firewall.
 *   - x402 audit fee (0.025 sUSDC one-shot when the venue requires
 *     attestation) and live Atlantic gas (converted to sUSDC)
 * and FILTERS OUT venues that violate the user's risk ceiling or the
 * on-chain Policy Firewall (whitelist / spend cap / attestation).
 */

export interface VaultMath {
  id: string
  label: string
  effectiveApyBps: bigint
  entryFeeBps: bigint
  exitFeeBps: bigint
  riskScore: number
  requiresX402Audit: boolean
  paused: boolean
  whitelisted: boolean
}

export interface PolicyContext {
  maxPerTxSpend: bigint
  maxSlippageBps: bigint
  requireWhitelistedVault: boolean
  requireValidX402Attestation: boolean
  /** user's own risk ceiling 0..100 */
  riskCeiling: number
}

export interface GasContext {
  /** estimated gas units for the guarded allocation tx */
  gasUnits: bigint
  /** gas price in wei (PHRS has 18 decimals) */
  gasPriceWei: bigint
  /** sUSDC per PHRS price (6-decimal sUSDC per 1 PHRS) */
  susdcPerPhrs: bigint
}

export interface VenueResult {
  id: string
  label: string
  eligible: boolean
  excludedReason?: string
  breakdown: {
    principal: bigint
    entryFee: bigint
    invested: bigint
    grossYield: bigint
    effectiveApyBps: bigint
    proceedsBeforeExitFee: bigint
    exitFee: bigint
    x402Fee: bigint
    gasCostSusdc: bigint
    netReturn: bigint
    netApyBps: bigint
  }
}

export interface HorizonRouteResult {
  depositAmount: bigint
  horizonDays: number
  venues: VenueResult[]
  winner: VenueResult | null
  notes: string[]
}

const BPS = 10_000n
const DAYS_PER_YEAR = 365n

/**
 * Exact bigint net-return math for ONE venue over the holding horizon.
 * Program fees (entry/exit) are amortized over the horizon: fee = notional × fee_bps × T / (365 × BPS).
 * net = grossYield − amortizedEntryFee − amortizedExitFee − x402Fee − gasCost
 * (the full principal dx is deployed; amortized fees are cost lines, not principal reductions)
 */
export function projectVenue(v: VaultMath, dx: bigint, TDays: number, policy: PolicyContext, gas: GasContext): VenueResult {
  const principal = dx
  const horizonDays = BigInt(Math.max(1, Math.floor(TDays)))
  const feeAmortizer = (notional: bigint, feeBps: bigint) => (notional * feeBps * horizonDays) / (BPS * DAYS_PER_YEAR)
  const entryFee = feeAmortizer(dx, v.entryFeeBps)
  const invested = dx
  const effectiveApyBps = v.effectiveApyBps
  const grossYield = (dx * effectiveApyBps * horizonDays) / (BPS * DAYS_PER_YEAR)
  const proceedsBeforeExitFee = dx + grossYield
  const exitFee = feeAmortizer(proceedsBeforeExitFee, v.exitFeeBps)
  const x402Fee = v.requiresX402Audit ? 25_000n : 0n // 0.025 sUSDC paid oracle audit
  // gas: wei -> sUSDC directly (PHRS 18 decimals, sUSDC 6 decimals)
  const gasCostSusdc = (gas.gasUnits * gas.gasPriceWei * gas.susdcPerPhrs) / 1_000_000_000_000_000_000n
  const netReturn = invested + grossYield - entryFee - exitFee - x402Fee - gasCostSusdc - principal
  const denom = principal === 0n ? 1n : principal
  const netApyBps = (netReturn * BPS * DAYS_PER_YEAR) / (denom * horizonDays)

  // policy / risk filtering
  let excludedReason: string | undefined
  if (v.paused) excludedReason = "vault paused (fault-isolation circuit breaker active)"
  else if (policy.requireWhitelistedVault && !v.whitelisted) excludedReason = "UnwhitelistedTargetVault (Policy Firewall)"
  else if (v.riskScore > policy.riskCeiling) excludedReason = `riskScore ${v.riskScore} exceeds user risk ceiling ${policy.riskCeiling}`
  else if (dx > policy.maxPerTxSpend) excludedReason = "ExceedsPolicySpendCap (Policy Firewall)"
  else if (policy.requireValidX402Attestation && v.requiresX402Audit) excludedReason = undefined // allowed, fee priced in

  return {
    id: v.id,
    label: v.label,
    eligible: excludedReason === undefined,
    excludedReason,
    breakdown: {
      principal, entryFee, invested, grossYield, effectiveApyBps,
      proceedsBeforeExitFee, exitFee, x402Fee, gasCostSusdc, netReturn, netApyBps,
    },
  }
}

/** Route one (dx, T) request across all venues and rank eligible ones. */
export function routeHorizon(
  venues: VaultMath[],
  dx: bigint,
  TDays: number,
  policy: PolicyContext,
  gas: GasContext,
): HorizonRouteResult {
  const notes: string[] = []
  if (TDays <= 0) notes.push("horizon must be > 0 days; clamped to 1")
  const horizon = Math.max(1, Math.floor(TDays))

  const results = venues.map((v) => projectVenue(v, dx, horizon, policy, gas))
  const eligible = results.filter((r) => r.eligible).sort((a, b) => (b.breakdown.netReturn > a.breakdown.netReturn ? 1 : b.breakdown.netReturn < a.breakdown.netReturn ? -1 : 0))
  if (eligible.length === 0) notes.push("no venue passed the risk-ceiling and Policy Firewall filters — NO ACTION prepared (fail-closed)")
  const paused = results.filter((r) => r.excludedReason?.includes("paused"))
  if (paused.length) notes.push(`${paused.length} venue(s) isolated by circuit breaker and excluded from routing`)

  return {
    depositAmount: dx,
    horizonDays: horizon,
    venues: results,
    winner: eligible[0] ?? null,
    notes,
  }
}

/** SkillEngine default gas assumptions (Atlantic testnet is cheap). */
export function defaultGasContext(): GasContext {
  return { gasUnits: 350_000n, gasPriceWei: 2_000_000_000n /* 2 gwei */, susdcPerPhrs: 2_000_000n /* 2.00 sUSDC per PHRS */ }
}
