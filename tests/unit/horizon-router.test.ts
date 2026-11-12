/**
 * tests/unit/horizon-router.test.ts — Skill B: HorizonNetYieldRouterSkill.
 * Exact bigint net-return math across the 3 vaults + policy/risk filtering.
 */
import { describe, it, expect } from "vitest"
import { projectVenue, routeHorizon, defaultGasContext, type VaultMath, type PolicyContext, type GasContext } from "@/lib/skills/horizon-router"

const GAS: GasContext = { gasUnits: 350_000n, gasPriceWei: 2_000_000_000n, susdcPerPhrs: 2_000_000n }

const T_BILL: VaultMath = {
  id: "tbill", label: "Pharos T-Bill RWA Vault",
  effectiveApyBps: 815n, entryFeeBps: 0n, exitFeeBps: 0n,
  riskScore: 12, requiresX402Audit: false, paused: false, whitelisted: true,
}
const CREDIT: VaultMath = {
  id: "credit", label: "Atlantic Senior Credit Pool",
  effectiveApyBps: 1045n, entryFeeBps: 12n, exitFeeBps: 5n,
  riskScore: 58, requiresX402Audit: true, paused: false, whitelisted: true,
}
const HARBOR: VaultMath = {
  id: "harbor", label: "Harbor Buffer Pool",
  effectiveApyBps: 740n, entryFeeBps: 0n, exitFeeBps: 5n,
  riskScore: 34, requiresX402Audit: false, paused: false, whitelisted: true,
}

const POLICY: PolicyContext = {
  maxPerTxSpend: 5_000_000_000n,
  maxSlippageBps: 30n,
  requireWhitelistedVault: true,
  requireValidX402Attestation: true,
  riskCeiling: 60,
}

describe("projectVenue — T-Bill (0/0 fees, no x402)", () => {
  const dx = 2_500_000_000n
  const r = projectVenue(T_BILL, dx, 30, POLICY, GAS)
  it("charges no entry fee", () => {
    expect(r.breakdown.entryFee).toBe(0n)
    expect(r.breakdown.invested).toBe(dx)
  })
  it("computes exact 30d gross yield at 815 bps", () => {
    const expected = (dx * 815n * 30n) / (10_000n * 365n)
    expect(r.breakdown.grossYield).toBe(expected)
  })
  it("charges no exit fee", () => {
    expect(r.breakdown.exitFee).toBe(0n)
  })
  it("charges no x402 fee", () => {
    expect(r.breakdown.x402Fee).toBe(0n)
  })
  it("models gas in sUSDC (2 gwei * 350k * $2/PHRS)", () => {
    // 350000 * 2e9 = 7e14 wei; * 2 sUSDC/PHRS / 1e18 = 1400 micro-sUSDC
    expect(r.breakdown.gasCostSusdc).toBe(1_400n)
  })
  it("nets principal + yield - gas", () => {
    expect(r.breakdown.netReturn).toBe(r.breakdown.grossYield - 1_400n)
  })
  it("is eligible under the default policy", () => {
    expect(r.eligible).toBe(true)
    expect(r.excludedReason).toBeUndefined()
  })
  it("computes netApyBps close to nominal for zero-fee venue", () => {
    // slightly below 815 due to gas
    expect(r.breakdown.netApyBps).toBeGreaterThan(800n)
    expect(r.breakdown.netApyBps).toBeLessThanOrEqual(815n)
  })
})

describe("projectVenue — Credit (12/5 fees amortized over horizon + x402)", () => {
  const dx = 2_500_000_000n
  const r = projectVenue(CREDIT, dx, 30, POLICY, GAS)
  it("charges the 12 bps entry fee amortized over the 30d horizon", () => {
    expect(r.breakdown.entryFee).toBe((dx * 12n * 30n) / (10_000n * 365n)) // 246,575 micro
    expect(r.breakdown.invested).toBe(dx) // full principal deployed under the amortized model
  })
  it("applies the effectiveApyBps passed in (credit arrives pre-normalized from Chain MCP)", () => {
    const expected = (dx * 1045n * 30n) / (10_000n * 365n)
    expect(r.breakdown.grossYield).toBe(expected)
  })
  it("charges a 5 bps exit fee on proceeds, amortized over the horizon", () => {
    const proceeds = r.breakdown.invested + r.breakdown.grossYield
    expect(r.breakdown.exitFee).toBe((proceeds * 5n * 30n) / (10_000n * 365n))
  })
  it("prices the 0.025 sUSDC x402 audit fee", () => {
    expect(r.breakdown.x402Fee).toBe(25_000n)
  })
  it("is eligible for riskCeiling 60", () => {
    expect(r.eligible).toBe(true)
  })
})

describe("projectVenue — Harbor (0/5 fees)", () => {
  const dx = 1_000_000_000n
  const r = projectVenue(HARBOR, dx, 30, POLICY, GAS)
  it("charges no entry fee and a 5 bps exit fee amortized over the horizon", () => {
    expect(r.breakdown.entryFee).toBe(0n)
    const proceeds = r.breakdown.invested + r.breakdown.grossYield
    expect(r.breakdown.exitFee).toBe((proceeds * 5n * 30n) / (10_000n * 365n))
  })
  it("computes exact 30d yield at 740 bps", () => {
    expect(r.breakdown.grossYield).toBe((dx * 740n * 30n) / (10_000n * 365n)) // 6,082,191 micro
  })
})

describe("projectVenue — math invariants", () => {
  it("netReturn is exact: invested + grossYield - entryFee - exitFee - x402Fee - gasCost - principal", () => {
    for (const v of [T_BILL, CREDIT, HARBOR]) {
      const r = projectVenue(v, 2_333_333_333n, 45, POLICY, GAS)
      const expected = r.breakdown.invested + r.breakdown.grossYield - r.breakdown.entryFee - r.breakdown.exitFee - r.breakdown.x402Fee - r.breakdown.gasCostSusdc - r.breakdown.principal
      expect(r.breakdown.netReturn).toBe(expected)
    }
  })
  it("never loses money to rounding (yield floors toward the user)", () => {
    const r = projectVenue(T_BILL, 1n, 365, POLICY, GAS)
    expect(r.breakdown.netReturn).toBeGreaterThanOrEqual(0n - r.breakdown.gasCostSusdc)
  })
  it("zero horizon is clamped to 1 day", () => {
    const routed = routeHorizon([T_BILL], 1_000_000n, 0, POLICY, GAS)
    expect(routed.horizonDays).toBe(1)
    expect(routed.notes.some((n) => n.includes("clamped"))).toBe(true)
  })
  it("365-day horizon yields ~ nominal APY", () => {
    const r = projectVenue(T_BILL, 100_000_000n, 365, POLICY, GAS)
    expect(r.breakdown.grossYield).toBe(8_150_000n) // exactly 815 bps on 100 sUSDC
  })
})

describe("policy & risk filtering", () => {
  it("excludes venues above the user's risk ceiling", () => {
    const strict: PolicyContext = { ...POLICY, riskCeiling: 30 }
    const r = projectVenue(CREDIT, 1_000_000n, 30, strict, GAS)
    expect(r.eligible).toBe(false)
    expect(r.excludedReason).toContain("riskScore 58")
  })
  it("excludes paused venues (circuit breaker)", () => {
    const r = projectVenue({ ...HARBOR, paused: true }, 1_000_000n, 30, POLICY, GAS)
    expect(r.eligible).toBe(false)
    expect(r.excludedReason).toContain("paused")
  })
  it("excludes unwhitelisted venues", () => {
    const r = projectVenue({ ...T_BILL, whitelisted: false }, 1_000_000n, 30, POLICY, GAS)
    expect(r.eligible).toBe(false)
    expect(r.excludedReason).toContain("UnwhitelistedTargetVault")
  })
  it("excludes amounts above the per-tx spend cap", () => {
    const r = projectVenue(T_BILL, 15_000_000_000n, 30, POLICY, GAS)
    expect(r.eligible).toBe(false)
    expect(r.excludedReason).toContain("ExceedsPolicySpendCap")
  })
  it("pause takes precedence in the exclusion reason chain", () => {
    const r = projectVenue({ ...CREDIT, paused: true, whitelisted: false }, 1_000_000n, 30, { ...POLICY, riskCeiling: 10 }, GAS)
    expect(r.excludedReason).toContain("paused")
  })
})

describe("routeHorizon — ranking & winner", () => {
  it("ranks credit first for a 30d moderate-risk deposit", () => {
    const out = routeHorizon([T_BILL, CREDIT, HARBOR], 2_500_000_000n, 30, POLICY, GAS)
    expect(out.winner?.id).toBe("credit")
  })
  it("falls back to T-Bill under a strict risk ceiling", () => {
    const out = routeHorizon([T_BILL, CREDIT, HARBOR], 2_500_000_000n, 30, { ...POLICY, riskCeiling: 20 }, GAS)
    expect(out.winner?.id).toBe("tbill")
  })
  it("returns null winner and fail-closed note when everything is filtered", () => {
    const out = routeHorizon(
      [T_BILL, CREDIT, HARBOR],
      99_000_000_000n, // above cap
      30, POLICY, GAS,
    )
    expect(out.winner).toBeNull()
    expect(out.notes.some((n) => n.includes("fail-closed"))).toBe(true)
  })
  it("isolates paused venues and notes the failover", () => {
    const out = routeHorizon([{ ...HARBOR, paused: true }, T_BILL, CREDIT], 1_000_000_000n, 30, POLICY, GAS)
    expect(out.winner?.id).toBe("credit")
    expect(out.notes.some((n) => n.includes("circuit breaker"))).toBe(true)
  })
  it("returns all venues with eligibility flags", () => {
    const out = routeHorizon([T_BILL, CREDIT, HARBOR], 1_000_000n, 30, { ...POLICY, riskCeiling: 20 }, GAS)
    expect(out.venues).toHaveLength(3)
    expect(out.venues.find((v) => v.id === "credit")!.eligible).toBe(false)
    expect(out.venues.find((v) => v.id === "tbill")!.eligible).toBe(true)
  })
  it("preserves depositAmount and horizon in the result", () => {
    const out = routeHorizon([T_BILL], 7_777_777n, 14, POLICY, GAS)
    expect(out.depositAmount).toBe(7_777_777n)
    expect(out.horizonDays).toBe(14)
  })
  it("winner is always eligible", () => {
    const out = routeHorizon([T_BILL, CREDIT, HARBOR], 2_500_000_000n, 30, POLICY, GAS)
    expect(out.winner?.eligible).toBe(true)
  })
  it("net yield ordering matches naive APY ordering for equal fees", () => {
    const a = projectVenue({ ...T_BILL, effectiveApyBps: 500n }, 1_000_000n, 30, POLICY, GAS)
    const b = projectVenue({ ...T_BILL, effectiveApyBps: 900n }, 1_000_000n, 30, POLICY, GAS)
    expect(b.breakdown.netReturn).toBeGreaterThan(a.breakdown.netReturn)
  })
})

describe("acceptance — gentle-dilution normalizer drives the live ranking", () => {
  // credit venue as it arrives from Chain MCP after the effective-APY normalizer:
  // base 1045 bps at 42% utilization → 1045 × (10000 − 4200×1400/10000)/10000 = 983 bps
  const CREDIT_DILUTED: VaultMath = { ...CREDIT, effectiveApyBps: 983n }

  it("routes a 2,500 sUSDC / 30d / risk-ceiling-60 ticket to aCRED (credit)", () => {
    const out = routeHorizon([T_BILL, CREDIT_DILUTED, HARBOR], 2_500_000_000n, 30, POLICY, GAS)
    expect(out.winner?.id).toBe("credit")
  })
  it("routes the same ticket to pTBILL when the ceiling drops below aCRED's risk score (58)", () => {
    const out = routeHorizon([T_BILL, CREDIT_DILUTED, HARBOR], 2_500_000_000n, 30, { ...POLICY, riskCeiling: 57 }, GAS)
    expect(out.winner?.id).toBe("tbill")
  })
  it("yields ~9.6% horizon-adjusted net APY for the aCRED reference ticket", () => {
    const r = projectVenue(CREDIT_DILUTED, 2_500_000_000n, 30, POLICY, GAS)
    // gross 20,198,630 − entry 246,575 − exit 103,571 − x402 25,000 − gas 1,400 = 19,822,084
    // → netApy = 19,822,084 × 10,000 × 365 / (2.5e9 × 30) = 964 bps
    expect(r.breakdown.netApyBps).toBe(964n)
  })
  it("keeps fee-free pTBILL at ~nominal net APY for the same ticket", () => {
    const r = projectVenue(T_BILL, 2_500_000_000n, 30, POLICY, GAS)
    expect(r.breakdown.netApyBps).toBeGreaterThan(800n)
    expect(r.breakdown.netApyBps).toBeLessThanOrEqual(815n)
  })
})

describe("defaultGasContext", () => {
  it("models Atlantic testnet cheap gas", () => {
    const g = defaultGasContext()
    expect(g.gasUnits).toBe(350_000n)
    expect(g.gasPriceWei).toBe(2_000_000_000n)
    expect(g.susdcPerPhrs).toBe(2_000_000n)
  })
  it("produces sub-cent gas costs in sUSDC", () => {
    const g = defaultGasContext()
    const gasSusdc = (g.gasUnits * g.gasPriceWei * g.susdcPerPhrs) / 10n ** 18n / 10n ** 6n
    expect(gasSusdc).toBeLessThan(10_000n) // < 0.01 sUSDC
  })
})
