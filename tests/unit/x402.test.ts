/**
 * tests/unit/x402.test.ts — Tool #3: x402 micropayment client handshake.
 * Uses a fully-mocked in-process "oracle server" implementing the REAL
 * HTTP 402 -> ROI gate -> signed replay -> 200 semantics.
 */
import { describe, it, expect } from "vitest"
import { fetchPaidAttestation, buildTypedData, hashCanonical, type PaymentSigner } from "@/lib/x402/client"
import { canonicalAttestationBytes, type X402Attestation, type X402Challenge } from "@/lib/x402/types"

const CHALLENGE: X402Challenge = {
  x402Version: 1,
  scheme: "exact",
  price: "25000",
  asset: "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b",
  recipient: "0x4bf82bc533befdafa0a0d2154842394b37a40ea1",
  nonce: ("0x" + "11".repeat(32)) as `0x${string}`,
  chainId: 688689,
  expiry: Math.floor(Date.now() / 1000) + 900,
  resource: "/api/x402/attestation?vault=credit",
  description: "Sentinel x402 CreditDefaultRiskFeed audit",
  provider: "CreditDefaultRiskFeed",
}

function makeAttestation(): X402Attestation {
  const a: X402Attestation = {
    provider: "CreditDefaultRiskFeed",
    vault: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
    vaultLabel: "Atlantic Senior Credit Pool",
    collateralRatioBps: 10_240,
    navPerShare: "1000000",
    auditHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
    attestedAt: Math.floor(Date.now() / 1000),
    chainId: 688689,
    feePaid: "25000",
    serverSignature: "",
  }
  a.serverSignature = "hmac-" + hashCanonical(canonicalAttestationBytes({ ...a, serverSignature: "" })).slice(2, 18)
  return a
}

/** Mock oracle implementing the 402->200 protocol. */
function mockOracle(opts: {
  challenge?: X402Challenge | null
  expectPayment?: boolean
  tamperReceipt?: boolean
  failReplayStatus?: number
  calls?: { count: number; lastHeaders?: Headers | null; idempotencyKeys: string[] }
}): typeof fetch {
  const att = makeAttestation()
  const calls = opts.calls ?? { count: 0, lastHeaders: null, idempotencyKeys: [] }
  return (async (url: any, init?: any): Promise<Response> => {
    calls.count++
    const headers = new Headers(init?.headers ?? {})
    calls.lastHeaders = headers
    const idem = headers.get("x-idempotency-key")
    if (idem) calls.idempotencyKeys.push(idem)

    if (!headers.get("x-payment")) {
      const challenge = opts.challenge === undefined ? CHALLENGE : opts.challenge
      if (!challenge) return new Response("gone", { status: 500 })
      return new Response(JSON.stringify({ error: "payment_required" }), {
        status: 402,
        headers: { "x-payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") },
      })
    }
    if (opts.expectPayment === false) return new Response("unexpected payment", { status: 400 })
    if (opts.failReplayStatus) return new Response("declined", { status: opts.failReplayStatus })
    const receiptHash = hashCanonical(canonicalAttestationBytes(att))
    return new Response(
      JSON.stringify({ attestation: att, receiptHash: opts.tamperReceipt ? ("0x" + "ff".repeat(32)) : receiptHash, replayed: false }),
      { status: 200 },
    )
  }) as typeof fetch
}

const USER = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C" as const
const signer: PaymentSigner = async (typedData) => {
  // In production this is the USER's wallet (wagmi). Here: deterministic stub.
  expect(typedData.primaryType).toBe("TransferWithAuthorization")
  return ("0x" + "42".repeat(65)) as `0x${string}`
}

const baseOpts = {
  baseUrl: "http://mock",
  vaultKey: "credit" as const,
  userWallet: USER,
  signPayment: signer,
  budget: { spent: 0n, cap: 500_000n },
  expectedYieldDelta: 50_000n, // 0.05 sUSDC expected value > 0.025 fee
}

describe("happy path — full 402 -> 200 handshake", () => {
  it("completes in exactly 2 attempts", async () => {
    const calls = { count: 0, lastHeaders: null as Headers | null, idempotencyKeys: [] as string[] }
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({ calls }) })
    expect(r.status).toBe("ok")
    expect(r.telemetry.attempts).toBe(2)
    expect(r.telemetry.challengeReceived).toBe(true)
  })
  it("first attempt receives HTTP 402 with a challenge", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({}) })
    expect(r.telemetry.challengeReceived).toBe(true)
    expect(r.challenge?.chainId).toBe(688689)
    expect(r.challenge?.price).toBe("25000")
  })
  it("replays with an X-PAYMENT header carrying the signed payload", async () => {
    const calls = { count: 0, lastHeaders: null as Headers | null, idempotencyKeys: [] as string[] }
    await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({ calls }) })
    const paymentHeader = calls.lastHeaders!.get("x-payment")!
    expect(paymentHeader).toBeTruthy()
    const parsed = JSON.parse(paymentHeader)
    expect(parsed.scheme).toBe("exact")
    expect(parsed.payload.from).toBe(USER)
    expect(parsed.payload.signature).toMatch(/^0x[0-9a-f]+$/)
  })
  it("carries an idempotency key on the paid replay", async () => {
    const calls = { count: 0, lastHeaders: null as Headers | null, idempotencyKeys: [] as string[] }
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({ calls }) })
    expect(r.idempotencyKey).toBeTruthy()
    expect(calls.idempotencyKeys).toEqual([r.idempotencyKey])
  })
  it("returns the attestation with collateralRatioBps 10240", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({}) })
    expect(r.attestation?.collateralRatioBps).toBe(10_240)
    expect(r.attestation?.provider).toBe("CreditDefaultRiskFeed")
  })
  it("returns a keccak receipt hash ready for the firewall", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({}) })
    expect(r.receiptHash).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it("verifies the receipt hash client-side (tamper-evident)", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({}) })
    expect(hashCanonical(canonicalAttestationBytes(r.attestation!))).toBe(r.receiptHash)
  })
  it("flags tampered receipts via the recomputed hash", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({ tamperReceipt: true }) })
    expect(r.status).toBe("ok")
    expect(r.reason).toContain("tamper check failed")
  })
  it("records the ROI check in telemetry", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({}) })
    expect(r.telemetry.roiCheck).toEqual({ expectedYieldDelta: 50_000n, feeCost: 25_000n, passed: true })
  })
  it("records the budget check in telemetry", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({}) })
    expect(r.telemetry.budgetCheck).toEqual({ spentBefore: 0n, fee: 25_000n, cap: 500_000n, passed: true })
  })
})

describe("ROI gate", () => {
  it("refuses to pay when expectedYieldDelta <= fee", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, expectedYieldDelta: 25_000n, fetchImpl: mockOracle({}) })
    expect(r.status).toBe("rejected")
    expect(r.reason).toContain("ROI gate failed")
    expect(r.telemetry.attempts).toBe(1) // never attempted the paid replay
  })
  it("refuses to pay when expected value is 0", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, expectedYieldDelta: 0n, fetchImpl: mockOracle({}) })
    expect(r.status).toBe("rejected")
  })
  it("pays when expected value barely exceeds the fee", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, expectedYieldDelta: 25_001n, fetchImpl: mockOracle({}) })
    expect(r.status).toBe("ok")
  })
  it("exposes the challenge on ROI rejection for UI display", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, expectedYieldDelta: 0n, fetchImpl: mockOracle({}) })
    expect(r.challenge?.provider).toBe("CreditDefaultRiskFeed")
  })
})

describe("session budget cap", () => {
  it("rejects payment that would exceed the session cap", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, budget: { spent: 480_000n, cap: 500_000n }, fetchImpl: mockOracle({}) })
    expect(r.status).toBe("rejected")
    expect(r.reason).toContain("budget cap exceeded")
  })
  it("allows payment exactly up to the cap boundary", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, budget: { spent: 475_000n, cap: 500_000n }, fetchImpl: mockOracle({}) })
    expect(r.status).toBe("ok")
  })
  it("rejects when budget is fully spent", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, budget: { spent: 500_000n, cap: 500_000n }, fetchImpl: mockOracle({}) })
    expect(r.status).toBe("rejected")
    expect(r.telemetry.budgetCheck?.passed).toBe(false)
  })
})

describe("signing delegation (non-custodial airgap)", () => {
  it("invokes the caller-provided signer exactly once", async () => {
    let signCalls = 0
    const spySigner: PaymentSigner = async (td) => {
      signCalls++
      return await signer(td)
    }
    await fetchPaidAttestation({ ...baseOpts, signPayment: spySigner, fetchImpl: mockOracle({}) })
    expect(signCalls).toBe(1)
  })
  it("propagates user rejection as payment_required (never throws)", async () => {
    const rejectingSigner: PaymentSigner = async () => {
      throw new Error("User rejected the signature request")
    }
    const r = await fetchPaidAttestation({ ...baseOpts, signPayment: rejectingSigner, fetchImpl: mockOracle({}) })
    expect(r.status).toBe("payment_required")
    expect(r.reason).toContain("User rejected")
  })
  it("buildTypedData produces EIP-3009 TransferWithAuthorization", () => {
    const td = buildTypedData(CHALLENGE, USER, 1000, 2000)
    expect(td.domain.chainId).toBe(688689)
    expect(td.primaryType).toBe("TransferWithAuthorization")
    expect(td.message.from).toBe(USER)
    expect(td.message.to).toBe(CHALLENGE.recipient)
    expect(td.message.value).toBe(25_000n)
    expect(td.message.nonce).toBe(CHALLENGE.nonce)
    expect((td.types.TransferWithAuthorization as Array<{ name: string }>)[0].name).toBe("from")
  })
})

describe("fault handling", () => {
  it("rejects when the oracle does not challenge (no 402 first)", async () => {
    const rogue = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: rogue })
    expect(r.status).toBe("rejected")
    expect(r.reason).toContain("expected HTTP 402 challenge, got 200")
  })
  it("rejects when the 402 has no challenge header", async () => {
    const noHeader = async () => new Response("pay me", { status: 402 })
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: noHeader })
    expect(r.status).toBe("rejected")
    expect(r.reason).toContain("missing/invalid X-PAYMENT-REQUIRED")
  })
  it("rejects when the paid replay fails (402 again)", async () => {
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: mockOracle({ failReplayStatus: 402 }) })
    expect(r.status).toBe("rejected")
    expect(r.reason).toContain("paid replay failed with 402")
  })
  it("survives network errors without throwing", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: failing })
    expect(r.status).toBe("rejected")
    expect(r.reason).toContain("network error")
  })
  it("parses raw-JSON (non-base64) challenge headers too", async () => {
    const rawJson = (async (_url: any, init?: any): Promise<Response> => {
      const headers = new Headers(init?.headers ?? {})
      if (!headers.get("x-payment")) {
        return new Response("402", { status: 402, headers: { "x-payment-required": JSON.stringify(CHALLENGE) } })
      }
      const att = makeAttestation()
      return new Response(JSON.stringify({ attestation: att, receiptHash: hashCanonical(canonicalAttestationBytes(att)) }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchPaidAttestation({ ...baseOpts, fetchImpl: rawJson })
    expect(r.status).toBe("ok")
  })
})

describe("canonical attestation bytes", () => {
  it("are stable for identical attestations", () => {
    const a = makeAttestation()
    expect(canonicalAttestationBytes(a)).toBe(canonicalAttestationBytes(a))
  })
  it("change when any field is tampered", () => {
    const a = makeAttestation()
    const b = { ...a, collateralRatioBps: 9_999 }
    expect(canonicalAttestationBytes(a)).not.toBe(canonicalAttestationBytes(b))
  })
  it("hashCanonical produces keccak256-length output", () => {
    expect(hashCanonical("x")).toMatch(/^0x[0-9a-f]{64}$/)
  })
})
