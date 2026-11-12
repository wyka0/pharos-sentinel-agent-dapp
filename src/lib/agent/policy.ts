/**
 * src/lib/agent/policy.ts — Policy Firewall MIRROR (pre-flight) + types.
 *
 * The on-chain SentinelPolicyFirewall is the FINAL arbiter; this module is
 * the agent's 1:1 mirror used to pre-flight every prepared action BEFORE
 * any signature is requested from the user (fail-closed: no bundle is ever
 * emitted for a blocked action).
 *
 * NO SIGNER MATERIAL lives here or anywhere in src/.
 */
import { keccak256, toHex } from "viem"

export const ERROR_SELECTORS = {
  ExceedsPolicySpendCap: keccak256(toHex("ExceedsPolicySpendCap(uint256,uint256)")).slice(0, 10),
  UnwhitelistedTargetVault: keccak256(toHex("UnwhitelistedTargetVault(address)")).slice(0, 10),
  MissingX402AuditAttestation: keccak256(toHex("MissingX402AuditAttestation()")).slice(0, 10),
  SlippageExceeded: keccak256(toHex("SlippageExceeded(uint256,uint256)")).slice(0, 10),
  FirewallPaused: keccak256(toHex("FirewallPaused()")).slice(0, 10),
  ReplayProtectedIntentDigest: keccak256(toHex("ReplayProtectedIntentDigest()")).slice(0, 10),
} as const

export interface PolicyRules {
  maxPerTxSpend: bigint
  maxSlippageBps: bigint
  requireWhitelistedVault: boolean
  requireValidX402Attestation: boolean
  emergencyPaused: boolean
}

export const DEFAULT_POLICY: PolicyRules = {
  maxPerTxSpend: 5_000_000_000n, // 5,000 sUSDC
  maxSlippageBps: 30n,
  requireWhitelistedVault: true,
  requireValidX402Attestation: true,
  emergencyPaused: false,
}

export interface GuardOutcome {
  guard: "G1_KILL_SWITCH" | "G2_SPEND_CAP" | "G3_VAULT_WHITELIST" | "G4_X402_ATTESTATION" | "G5_SLIPPAGE"
  passed: boolean
  detail: string
  customError?: keyof typeof ERROR_SELECTORS
}

export interface PolicyCheckReport {
  passed: boolean
  outcomes: GuardOutcome[]
  checkedAt: string
  source: "mirror+chain-simulate"
}

/**
 * Run the 5 guards in the exact on-chain order. Fail-closed.
 */
export function runPolicyGuards(input: {
  amount: bigint
  vaultAddress: string
  vaultWhitelisted: boolean
  vaultPaused: boolean
  x402ReceiptHash: `0x${string}` | null
  minSharesOut: bigint
  quotedShares: bigint
  policy: PolicyRules
  agentEmergencyPaused?: boolean
}): PolicyCheckReport {
  const outcomes: GuardOutcome[] = []

  // G1 — kill switch
  const g1 = !input.policy.emergencyPaused && !input.agentEmergencyPaused
  outcomes.push({
    guard: "G1_KILL_SWITCH", passed: g1,
    detail: `emergencyPaused(user)=${input.policy.emergencyPaused} emergencyPaused(agent)=${Boolean(input.agentEmergencyPaused)}`,
    customError: g1 ? undefined : "FirewallPaused",
  })

  // G2 — per-tx spend cap
  const g2 = input.amount <= input.policy.maxPerTxSpend
  outcomes.push({
    guard: "G2_SPEND_CAP", passed: g2,
    detail: g2
      ? `amount ${input.amount} vs maxPerTxSpend ${input.policy.maxPerTxSpend}`
      : `ExceedsPolicySpendCap(${input.amount}, ${input.policy.maxPerTxSpend})`,
    customError: g2 ? undefined : "ExceedsPolicySpendCap",
  })

  // G3 — whitelist
  const g3 = !input.policy.requireWhitelistedVault || (input.vaultWhitelisted && !input.vaultPaused)
  outcomes.push({
    guard: "G3_VAULT_WHITELIST", passed: g3,
    detail: `vault ${input.vaultAddress} whitelisted=${input.vaultWhitelisted} paused=${input.vaultPaused}`,
    customError: g3 ? undefined : "UnwhitelistedTargetVault",
  })

  // G4 — x402 attestation binding
  const g4 = !input.policy.requireValidX402Attestation || (input.x402ReceiptHash != null && input.x402ReceiptHash !== "0x0000000000000000000000000000000000000000000000000000000000000000")
  outcomes.push({
    guard: "G4_X402_ATTESTATION", passed: g4,
    detail: g4
      ? `x402ReceiptHash=${input.x402ReceiptHash ?? "null"}`
      : "MissingX402AuditAttestation()",
    customError: g4 ? undefined : "MissingX402AuditAttestation",
  })

  // G5 — slippage bound
  const g5 = input.quotedShares >= input.minSharesOut
  outcomes.push({
    guard: "G5_SLIPPAGE", passed: g5,
    detail: `quotedShares ${input.quotedShares} vs minSharesOut ${input.minSharesOut} (maxSlippageBps ${input.policy.maxSlippageBps})`,
    customError: g5 ? undefined : "SlippageExceeded",
  })

  return { passed: outcomes.every((o) => o.passed), outcomes, checkedAt: new Date().toISOString(), source: "mirror+chain-simulate" }
}

/** keccak256 agent intent digest — binds prompt + params + receipt on-chain. */
export function intentDigest(parts: {
  user: string
  prompt: string
  vault: string
  amount: bigint | string
  minSharesOut: bigint | string
  x402ReceiptHash: string
  horizonDays: number
  riskCeiling: number
}): `0x${string}` {
  const canonical = [
    "SENTINEL-INTENT-V1",
    parts.user.toLowerCase(),
    parts.prompt.trim(),
    parts.vault.toLowerCase(),
    parts.amount.toString(),
    parts.minSharesOut.toString(),
    parts.x402ReceiptHash.toLowerCase(),
    String(parts.horizonDays),
    String(parts.riskCeiling),
  ].join("|")
  return keccak256(toHex(canonical))
}
