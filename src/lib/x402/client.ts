/**
 * src/lib/x402/client.ts — TOOL #3: x402 Agent Micropayment Client
 * =====================================================================
 * Implements the REAL HTTP 402 handshake, with the non-custodial airgap
 * enforced by construction:
 *
 *   1. GET /api/x402/attestation?vault=...          -> HTTP 402 challenge
 *   2. ROI gate: expectedYieldDelta > fee AND session budget cap OK
 *      (the ROI inputs are supplied by SkillEngine evaluation)
 *   3. Signing is DELEGATED to a caller-provided `PaymentSigner` — the user's
 *      wallet (wagmi signTypedData in the UI) or the test payer (scripts/).
 *      THIS MODULE NEVER TOUCHES KEY MATERIAL. (Req 04 airgap)
 *   4. Replay with X-PAYMENT header + idempotency key -> HTTP 200 attestation
 *   5. Returns x402ReceiptHash ready to bind into SentinelPolicyFirewall.
 */

import { canonicalAttestationBytes, type X402Attestation, type X402Challenge, type X402PaymentHeader } from "./types"

export type VaultKey = "tbill" | "credit" | "harbor"

/** Non-custodial signing delegation: caller injects the user's wallet. */
export type PaymentSigner = (
  typedData: {
    domain: Record<string, unknown>
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: string
    message: Record<string, unknown>
  },
) => Promise<`0x${string}`>

export interface X402SessionBudget {
  /** session id (stable across the run) */
  sessionId: string
  /** cumulative spend in sUSDC base units */
  spent: bigint
  cap: bigint
}

export interface X402ClientResult {
  status: "ok" | "payment_required" | "rejected"
  reason?: string
  challenge?: X402Challenge
  attestation?: X402Attestation
  receiptHash?: `0x${string}`
  receiptBytes?: string
  idempotencyKey?: string
  telemetry: {
    attempts: number
    challengeReceived: boolean
    roiCheck?: { expectedYieldDelta: bigint; feeCost: bigint; passed: boolean }
    budgetCheck?: { spentBefore: bigint; fee: bigint; cap: bigint; passed: boolean }
    latencyMs: number
    paymentHeader?: X402PaymentHeader
  }
}

/** Build the EIP-712 typed data an EIP-3009 payer must sign. */
export function buildTypedData(challenge: X402Challenge, from: `0x${string}`, validAfter: number, validBefore: number) {
  return {
    domain: {
      name: "SentinelUSD",
      version: "1",
      chainId: challenge.chainId,
      verifyingContract: challenge.asset,
    },
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
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from,
      to: challenge.recipient,
      value: BigInt(challenge.price),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce: challenge.nonce,
    },
  }
}

/**
 * Full 402 -> 200 handshake.
 * @param baseUrl    origin of the Sentinel API (same-origin in prod)
 * @param vaultKey   which oracle feed to audit
 * @param userWallet the USER's wallet (payer + signer); never an agent key
 * @param signPayment non-custodial signer callback (wagmi in UI, script key in scripts/)
 * @param budget     session budget ledger (mutated by caller on success)
 * @param expectedYieldDelta  SkillEngine's projected value gained from the audit
 */
export async function fetchPaidAttestation(opts: {
  baseUrl: string
  vaultKey: VaultKey
  userWallet: `0x${string}`
  signPayment: PaymentSigner
  budget: { spent: bigint; cap: bigint }
  expectedYieldDelta: bigint
  fetchImpl?: typeof fetch
}): Promise<X402ClientResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const t0 = Date.now()
  const telemetry: X402ClientResult["telemetry"] = { attempts: 0, challengeReceived: false, latencyMs: 0 }
  const idempotencyKey = `idem-${opts.vaultKey}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  // ---- attempt 1: expect HTTP 402 challenge --------------------------------
  let res: Response
  try {
    res = await fetchImpl(`${opts.baseUrl}/api/x402/attestation?vault=${opts.vaultKey}`, {
      headers: { "x-sentinel-session": "sentinel-agent" },
    })
  } catch (e) {
    return { status: "rejected", reason: `network error: ${String(e)}`, telemetry: { ...telemetry, latencyMs: Date.now() - t0 } }
  }
  telemetry.attempts = 1

  if (res.status !== 402) {
    // A well-behaved oracle MUST challenge first; treat anything else as a fault.
    const bodyText = await res.text().catch(() => "")
    return {
      status: "rejected",
      reason: `expected HTTP 402 challenge, got ${res.status} ${bodyText.slice(0, 140)}`,
      telemetry: { ...telemetry, latencyMs: Date.now() - t0 },
    }
  }
  telemetry.challengeReceived = true

  const challenge: X402Challenge | null = parseChallenge(res.headers.get("x-payment-required"))
  if (!challenge) {
    return { status: "rejected", reason: "402 response missing/invalid X-PAYMENT-REQUIRED challenge", telemetry: { ...telemetry, latencyMs: Date.now() - t0 } }
  }

  // ---- ROI gate (Req: agent evaluates value before paying) -----------------
  const feeCost = BigInt(challenge.price)
  const roiCheck = { expectedYieldDelta: opts.expectedYieldDelta, feeCost, passed: opts.expectedYieldDelta > feeCost }
  telemetry.roiCheck = roiCheck
  if (!roiCheck.passed) {
    return { status: "rejected", reason: "ROI gate failed: expectedYieldDelta <= x402 fee", challenge, telemetry: { ...telemetry, latencyMs: Date.now() - t0 } }
  }

  // ---- budget cap gate ------------------------------------------------------
  const spentBefore = opts.budget.spent
  const budgetCheck = { spentBefore, fee: feeCost, cap: opts.budget.cap, passed: spentBefore + feeCost <= opts.budget.cap }
  telemetry.budgetCheck = budgetCheck
  if (!budgetCheck.passed) {
    return { status: "rejected", reason: "session budget cap exceeded", challenge, telemetry: { ...telemetry, latencyMs: Date.now() - t0 } }
  }

  // ---- NON-CUSTODIAL signing (delegated to the user's wallet) --------------
  const now = Math.floor(Date.now() / 1000)
  const validAfter = now - 60
  const validBefore = Math.min(challenge.expiry, now + 600)
  const typedData = buildTypedData(challenge, opts.userWallet, validAfter, validBefore)
  let signature: `0x${string}`
  try {
    signature = await opts.signPayment(typedData)
  } catch (e) {
    return { status: "payment_required", reason: `user rejected/failed payment signature: ${String(e)}`, challenge, telemetry: { ...telemetry, latencyMs: Date.now() - t0 } }
  }

  const paymentHeader: X402PaymentHeader = {
    scheme: "exact",
    payload: { from: opts.userWallet, signature, validAfter: String(validAfter), validBefore: String(validBefore), nonce: challenge.nonce },
    idempotencyKey,
    challengeNonce: challenge.nonce,
  }
  telemetry.paymentHeader = { ...paymentHeader, payload: { ...paymentHeader.payload } }

  // ---- attempt 2: replay with X-PAYMENT ------------------------------------
  let res2: Response
  try {
    res2 = await fetchImpl(`${opts.baseUrl}/api/x402/attestation?vault=${opts.vaultKey}`, {
      headers: {
        "x-payment": JSON.stringify(paymentHeader),
        "x-idempotency-key": idempotencyKey,
        "x-sentinel-session": "sentinel-agent",
      },
    })
  } catch (e) {
    return { status: "rejected", reason: `network error on replay: ${String(e)}`, challenge, telemetry: { ...telemetry, latencyMs: Date.now() - t0 } }
  }
  telemetry.attempts = 2

  if (res2.status !== 200) {
    const bodyText = await res2.text().catch(() => "")
    return { status: "rejected", reason: `paid replay failed with ${res2.status}: ${bodyText.slice(0, 140)}`, challenge, telemetry: { ...telemetry, latencyMs: Date.now() - t0 } }
  }

  const receipt = (await res2.json()) as { attestation: X402Attestation; receiptHash: string; replayed?: boolean }
  const attestation = receipt.attestation
  const receiptHash = receipt.receiptHash as `0x${string}`

  // tamper-evidence: recompute the canonical hash client-side (X402-5)
  const recomputed = hashCanonical(canonicalAttestationBytes(attestation))
  const okHash = recomputed === receiptHash

  return {
    status: "ok",
    reason: okHash ? undefined : "receipt hash mismatch (tamper check failed)",
    challenge,
    attestation,
    receiptHash,
    receiptBytes: canonicalAttestationBytes(attestation),
    idempotencyKey,
    telemetry: { ...telemetry, latencyMs: Date.now() - t0 },
  }
}

function parseChallenge(headerValue: string | null): X402Challenge | null {
  if (!headerValue) return null
  try {
    // header may be raw JSON or base64(JSON)
    const text = headerValue.trim().startsWith("{") ? headerValue : Buffer.from(headerValue, "base64").toString("utf8")
    const c = JSON.parse(text)
    if (c && typeof c === "object" && c.chainId && c.nonce && c.price) return c
    return null
  } catch {
    return null
  }
}

/** keccak256 of a UTF-8 string (uses viem; available server + client). */
import { keccak256, toHex } from "viem"
export function hashCanonical(bytes: string): `0x${string}` {
  return keccak256(toHex(bytes))
}
