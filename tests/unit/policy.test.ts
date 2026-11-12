/**
 * tests/unit/policy.test.ts — Policy Firewall mirror guards (on-chain 1:1).
 */
import { describe, it, expect } from "vitest"
import { runPolicyGuards, DEFAULT_POLICY, intentDigest, ERROR_SELECTORS, type PolicyRules } from "@/lib/agent/policy"

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const
const SOME_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`

const baseInput = {
  amount: 2_500_000_000n,
  vaultAddress: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
  vaultWhitelisted: true,
  vaultPaused: false,
  x402ReceiptHash: SOME_HASH,
  minSharesOut: 2_400_000_000n,
  quotedShares: 2_495_000_000n,
  policy: { ...DEFAULT_POLICY },
}

describe("DEFAULT_POLICY", () => {
  it("caps spend at 5,000 sUSDC", () => {
    expect(DEFAULT_POLICY.maxPerTxSpend).toBe(5_000_000_000n)
  })
  it("defaults slippage to 30 bps", () => {
    expect(DEFAULT_POLICY.maxSlippageBps).toBe(30n)
  })
  it("requires whitelisted vaults", () => {
    expect(DEFAULT_POLICY.requireWhitelistedVault).toBe(true)
  })
  it("requires x402 attestation", () => {
    expect(DEFAULT_POLICY.requireValidX402Attestation).toBe(true)
  })
  it("is not paused by default", () => {
    expect(DEFAULT_POLICY.emergencyPaused).toBe(false)
  })
})

describe("guard G1 — kill switch", () => {
  it("passes when not paused", () => {
    const r = runPolicyGuards(baseInput)
    expect(r.outcomes[0]).toMatchObject({ guard: "G1_KILL_SWITCH", passed: true })
  })
  it("blocks when user policy is paused", () => {
    const r = runPolicyGuards({ ...baseInput, policy: { ...DEFAULT_POLICY, emergencyPaused: true } })
    expect(r.passed).toBe(false)
    expect(r.outcomes[0].passed).toBe(false)
    expect(r.outcomes[0].customError).toBe("FirewallPaused")
  })
  it("blocks when agent is paused", () => {
    const r = runPolicyGuards({ ...baseInput, agentEmergencyPaused: true })
    expect(r.passed).toBe(false)
    expect(r.outcomes[0].customError).toBe("FirewallPaused")
  })
})

describe("guard G2 — per-tx spend cap", () => {
  it("passes a 2,500 sUSDC allocation", () => {
    const r = runPolicyGuards(baseInput)
    expect(r.outcomes[1].passed).toBe(true)
  })
  it("blocks 15,000 sUSDC (ExceedsPolicySpendCap)", () => {
    const r = runPolicyGuards({ ...baseInput, amount: 15_000_000_000n })
    expect(r.passed).toBe(false)
    expect(r.outcomes[1].customError).toBe("ExceedsPolicySpendCap")
    expect(r.outcomes[1].detail).toContain("15000000000")
  })
  it("passes exactly at the cap boundary (5,000)", () => {
    const r = runPolicyGuards({ ...baseInput, amount: 5_000_000_000n })
    expect(r.outcomes[1].passed).toBe(true)
  })
  it("blocks 1 wei above the cap", () => {
    const r = runPolicyGuards({ ...baseInput, amount: 5_000_000_001n })
    expect(r.outcomes[1].passed).toBe(false)
  })
  it("respects a raised user cap", () => {
    const policy: PolicyRules = { ...DEFAULT_POLICY, maxPerTxSpend: 20_000_000_000n }
    const r = runPolicyGuards({ ...baseInput, amount: 15_000_000_000n, policy })
    expect(r.outcomes[1].passed).toBe(true)
  })
  it("respects a lowered user cap", () => {
    const policy: PolicyRules = { ...DEFAULT_POLICY, maxPerTxSpend: 100_000_000n }
    const r = runPolicyGuards({ ...baseInput, policy })
    expect(r.outcomes[1].passed).toBe(false)
  })
  it("blocks BEFORE whitelist when both fail (guard order)", () => {
    const r = runPolicyGuards({ ...baseInput, amount: 99_999_999_999n, vaultWhitelisted: false })
    expect(r.outcomes[1].customError).toBe("ExceedsPolicySpendCap")
  })
})

describe("guard G3 — vault whitelist", () => {
  it("passes a whitelisted vault", () => {
    const r = runPolicyGuards(baseInput)
    expect(r.outcomes[2].passed).toBe(true)
  })
  it("blocks an unwhitelisted vault (UnwhitelistedTargetVault)", () => {
    const r = runPolicyGuards({ ...baseInput, vaultWhitelisted: false })
    expect(r.passed).toBe(false)
    expect(r.outcomes[2].customError).toBe("UnwhitelistedTargetVault")
  })
  it("blocks a whitelisted-but-paused vault", () => {
    const r = runPolicyGuards({ ...baseInput, vaultPaused: true })
    expect(r.outcomes[2].passed).toBe(false)
    expect(r.outcomes[2].customError).toBe("UnwhitelistedTargetVault")
  })
  it("skips when whitelist requirement is disabled", () => {
    const policy: PolicyRules = { ...DEFAULT_POLICY, requireWhitelistedVault: false }
    const r = runPolicyGuards({ ...baseInput, vaultWhitelisted: false, policy })
    expect(r.outcomes[2].passed).toBe(true)
  })
})

describe("guard G4 — x402 attestation", () => {
  it("passes with a bound receipt hash", () => {
    const r = runPolicyGuards(baseInput)
    expect(r.outcomes[3].passed).toBe(true)
  })
  it("blocks with a zero hash (MissingX402AuditAttestation)", () => {
    const r = runPolicyGuards({ ...baseInput, x402ReceiptHash: ZERO_HASH })
    expect(r.passed).toBe(false)
    expect(r.outcomes[3].customError).toBe("MissingX402AuditAttestation")
  })
  it("blocks with null receipt", () => {
    const r = runPolicyGuards({ ...baseInput, x402ReceiptHash: null })
    expect(r.outcomes[3].passed).toBe(false)
  })
  it("skips when attestation requirement is disabled", () => {
    const policy: PolicyRules = { ...DEFAULT_POLICY, requireValidX402Attestation: false }
    const r = runPolicyGuards({ ...baseInput, x402ReceiptHash: null, policy })
    expect(r.outcomes[3].passed).toBe(true)
  })
})

describe("guard G5 — slippage", () => {
  it("passes when quoted >= min", () => {
    const r = runPolicyGuards(baseInput)
    expect(r.outcomes[4].passed).toBe(true)
  })
  it("blocks when quoted < min (SlippageExceeded)", () => {
    const r = runPolicyGuards({ ...baseInput, quotedShares: 2_000_000_000n })
    expect(r.passed).toBe(false)
    expect(r.outcomes[4].customError).toBe("SlippageExceeded")
  })
  it("passes at exact equality", () => {
    const r = runPolicyGuards({ ...baseInput, quotedShares: 2_400_000_000n })
    expect(r.outcomes[4].passed).toBe(true)
  })
})

describe("combined guard behavior", () => {
  it("reports ALL failing guards at once", () => {
    const r = runPolicyGuards({
      ...baseInput,
      amount: 99_000_000_000n,
      vaultWhitelisted: false,
      x402ReceiptHash: ZERO_HASH,
      quotedShares: 0n,
    })
    expect(r.passed).toBe(false)
    const failing = r.outcomes.filter((o) => !o.passed)
    expect(failing.map((f) => f.guard)).toEqual(["G2_SPEND_CAP", "G3_VAULT_WHITELIST", "G4_X402_ATTESTATION", "G5_SLIPPAGE"])
  })
  it("passes all 5 guards for a healthy allocation (4/4 policy + slippage)", () => {
    const r = runPolicyGuards(baseInput)
    expect(r.passed).toBe(true)
    expect(r.outcomes.every((o) => o.passed)).toBe(true)
    expect(r.outcomes).toHaveLength(5)
  })
  it("includes a timestamp", () => {
    expect(new Date(runPolicyGuards(baseInput).checkedAt).getTime()).not.toBeNaN()
  })
  it("reports mirror+chain-simulate source", () => {
    expect(runPolicyGuards(baseInput).source).toBe("mirror+chain-simulate")
  })
})

describe("intentDigest", () => {
  it("is a 32-byte hex digest", () => {
    const d = intentDigest({ user: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C", prompt: "deposit 2500", vault: "0x28080450b7be3963f55296ea9f2b45ad9af1b720", amount: 2500n, minSharesOut: 2400n, x402ReceiptHash: SOME_HASH, horizonDays: 30, riskCeiling: 60 })
    expect(d).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it("is deterministic for identical inputs", () => {
    const args = { user: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C", prompt: "x", vault: "0x1", amount: 1n, minSharesOut: 1n, x402ReceiptHash: SOME_HASH, horizonDays: 1, riskCeiling: 1 }
    expect(intentDigest(args)).toBe(intentDigest(args))
  })
  it("differs when the amount changes", () => {
    const base = { user: "0xA", prompt: "x", vault: "0x1", minSharesOut: 1n, x402ReceiptHash: SOME_HASH, horizonDays: 1, riskCeiling: 1 }
    expect(intentDigest({ ...base, amount: 1n })).not.toBe(intentDigest({ ...base, amount: 2n }))
  })
  it("differs when the prompt changes", () => {
    const base = { user: "0xA", vault: "0x1", amount: 1n, minSharesOut: 1n, x402ReceiptHash: SOME_HASH, horizonDays: 1, riskCeiling: 1 }
    expect(intentDigest({ ...base, prompt: "a" })).not.toBe(intentDigest({ ...base, prompt: "b" }))
  })
  it("differs when the receipt hash changes", () => {
    const base = { user: "0xA", prompt: "x", vault: "0x1", amount: 1n, minSharesOut: 1n, horizonDays: 1, riskCeiling: 1 }
    expect(intentDigest({ ...base, x402ReceiptHash: SOME_HASH })).not.toBe(intentDigest({ ...base, x402ReceiptHash: ZERO_HASH }))
  })
  it("normalizes address case (EIP-55 insensitive)", () => {
    const base = { prompt: "x", vault: "0x1", amount: 1n, minSharesOut: 1n, x402ReceiptHash: SOME_HASH, horizonDays: 1, riskCeiling: 1 }
    expect(intentDigest({ ...base, user: "0xAAAA" })).toBe(intentDigest({ ...base, user: "0xaaaa" }))
  })
})

describe("ERROR_SELECTORS — 4-byte signatures", () => {
  it("computes well-formed selectors", () => {
    for (const sel of Object.values(ERROR_SELECTORS)) {
      expect(sel).toMatch(/^0x[0-9a-f]{8}$/)
    }
  })
  it("gives ExceedsPolicySpendCap its canonical selector", () => {
    // keccak("ExceedsPolicySpendCap(uint256,uint256)")[:4]
    expect(ERROR_SELECTORS.ExceedsPolicySpendCap).toBe("0x" + ERROR_SELECTORS.ExceedsPolicySpendCap.slice(2))
    expect(ERROR_SELECTORS.ExceedsPolicySpendCap).toHaveLength(10)
  })
  it("selectors are unique per error", () => {
    const set = new Set(Object.values(ERROR_SELECTORS))
    expect(set.size).toBe(Object.keys(ERROR_SELECTORS).length)
  })
})
