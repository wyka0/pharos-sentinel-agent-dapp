/**
 * tests/integration/api-routes.test.ts — live HTTP-less route handler tests.
 * Route handlers are exercised directly (no network): vaults/agent/trend/
 * policy/portfolio/system + the full x402 402->200 protocol including REAL
 * EIP-712 signature verification (test key allowed OUTSIDE src/).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { privateKeyToAccount } from "viem/accounts"

import { GET as vaultsGET } from "@/app/api/vaults/route"
import { POST as agentPOST } from "@/app/api/agent/route"
import { GET as x402GET } from "@/app/api/x402/attestation/route"
import { GET as trendGET, POST as trendPOST } from "@/app/api/trend/route"
import { GET as policyGET } from "@/app/api/policy/route"
import { GET as portfolioGET } from "@/app/api/portfolio/route"
import { GET as systemGET } from "@/app/api/system/route"

const USER = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C"
const TEST_KEY = ("0x" + "be".repeat(32)) as `0x${string}` // throwaway test-only key (never in src/)
const account = privateKeyToAccount(TEST_KEY)

function req(pathname: string, init?: RequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000${pathname}`, init as any)
}

describe("GET /api/system", () => {
  it("reports network + deployment + skill engine info", async () => {
    const res = await systemGET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.network.chainId).toBe(688689)
    expect(body.network.name).toContain("Atlantic")
    expect(Array.isArray(body.skillEngine.registry)).toBe(true)
    expect(body.skillEngine.registry).toHaveLength(2)
  })
  it("reports the x402 session ledger", async () => {
    const body = await (await systemGET()).json()
    expect(body.x402).toHaveProperty("sessionSpent")
    expect(body.x402).toHaveProperty("sessionBudgetCap")
  })
  it("is BigInt-safe (no 'bigint' type leaking into JSON)", async () => {
    const text = await (await systemGET()).text()
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

describe("GET /api/vaults", () => {
  it("returns a not-deployed hint when addresses are zero", async () => {
    const res = await vaultsGET()
    const body = await res.json()
    expect(body.deployed).toBe(false)
    expect(body.hint).toContain("npm run deploy")
    expect(body.catalog).toHaveLength(3)
  })
  it("includes the 3-vault static catalog with correct APYs", async () => {
    const body = await (await vaultsGET()).json()
    const apys = body.catalog.map((v: any) => v.baseApyBps).sort((a: number, b: number) => a - b)
    expect(apys).toEqual([740, 815, 1045])
  })
  it("catalog risk scores are ordered tbill < harbor < credit", async () => {
    const body = await (await vaultsGET()).json()
    const byId = Object.fromEntries(body.catalog.map((v: any) => [v.id, v.riskScore]))
    expect(byId.tbill).toBeLessThan(byId.harbor)
    expect(byId.harbor).toBeLessThan(byId.credit)
  })
})

describe("GET /api/policy", () => {
  it("400s without a user param", async () => {
    const res = await policyGET(req("/api/policy"))
    expect(res.status).toBe(400)
  })
  it("400s with a malformed address", async () => {
    const res = await policyGET(req("/api/policy?user=0x123"))
    expect(res.status).toBe(400)
  })
  it("returns defaults + error selectors when not deployed", async () => {
    const body = await (await policyGET(req(`/api/policy?user=${USER}`))).json()
    expect(body.deployed).toBe(false)
    expect(body.defaults.maxPerTxSpend).toBe("5000000000")
    expect(body.errorSelectors.ExceedsPolicySpendCap).toMatch(/^0x[0-9a-f]{8}$/)
  })
})

describe("GET /api/portfolio", () => {
  it("400s without user", async () => {
    expect((await portfolioGET(req("/api/portfolio"))).status).toBe(400)
  })
  it("returns deployed:false offline", async () => {
    const body = await (await portfolioGET(req(`/api/portfolio?user=${USER}`))).json()
    expect(body.deployed).toBe(false)
  })
})

describe("POST /api/agent", () => {
  it("400s without a prompt", async () => {
    const res = await agentPOST(req("/api/agent", { method: "POST", body: JSON.stringify({ userAddress: USER }) }))
    expect(res.status).toBe(400)
  })
  it("400s with a malformed userAddress", async () => {
    const res = await agentPOST(req("/api/agent", { method: "POST", body: JSON.stringify({ prompt: "x", userAddress: "nope" }) }))
    expect(res.status).toBe(400)
  })
  it("400s with invalid JSON", async () => {
    const res = await agentPOST(req("/api/agent", { method: "POST", body: "{bad json" }))
    expect(res.status).toBe(400)
  })
  it("returns a full pipeline for a valid request", async () => {
    const res = await agentPOST(req("/api/agent", {
      method: "POST",
      body: JSON.stringify({ prompt: "analyze best venue for 800 sUSDC over 14 days", userAddress: USER, skipX402: true }),
    }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.pipeline.length).toBeGreaterThanOrEqual(3)
    expect(["advisory", "blocked", "prepared", "payment_required"]).toContain(body.status)
  })
  it("is BigInt-safe JSON (amounts serialize as strings)", async () => {
    const res = await agentPOST(req("/api/agent", {
      method: "POST",
      body: JSON.stringify({ prompt: "deposit 2500 sUSDC", userAddress: USER, skipX402: true }),
    }))
    const text = await res.text()
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

describe("GET /api/trend", () => {
  it("returns rule semantics + empty memory on first boot", async () => {
    const body = await (await trendGET()).json()
    expect(body.ok).toBe(true)
    expect(body.rule.minObservations).toBe(3)
    expect(body.rule.dropThresholdBps).toBe("100")
    expect(body.rule.semantics).toContain("SPIKE_REJECTED")
  })
  it("exposes the x402 ledger", async () => {
    const body = await (await trendGET()).json()
    expect(body.x402Ledger).toHaveProperty("sessionBudgetCap")
    expect(Array.isArray(body.x402Ledger.payments)).toBe(true)
  })
})

describe("POST /api/trend — the ≥3-observation rule end-to-end", () => {
  beforeEach(async () => {
    // reset state dir contents (fresh state per test via unique vault ids)
  })

  it("rejects a single noisy drop 100→93→100 as SPIKE_REJECTED", async () => {
    const vault = `spike-${Date.now()}`
    const steps = ["a", "b", "c"]
    let last: any
    for (const [nav, step] of [["100000000", steps[0]], ["93000000", steps[1]], ["100000000", steps[2]]] as const) {
      last = await (await trendPOST(req("/api/trend", {
        method: "POST",
        body: JSON.stringify({ vaultId: vault, navMicro: nav, scenario: `spike-${step}` }),
      }))).json()
    }
    expect(last.verdict).toBe("SPIKE_REJECTED")
    expect(last.consecutiveDrops).toBe(0)
    expect(last.recommendation).toBeNull()
  })

  it("confirms 3 consecutive drops as TREND_CONFIRMED with T-Bill recommendation", async () => {
    const vault = `trend-${Date.now()}`
    let last: any
    for (const nav of ["100000000", "98000000", "95000000", "92000000"]) {
      last = await (await trendPOST(req("/api/trend", {
        method: "POST",
        body: JSON.stringify({ vaultId: vault, navMicro: nav, scenario: "trend" }),
      }))).json()
    }
    expect(last.verdict).toBe("TREND_CONFIRMED")
    expect(last.recommendation.action).toBe("REBALANCE_TO_TBILL")
    expect(last.consecutiveDrops).toBe(3)
  })

  it("400s on invalid bodies", async () => {
    expect((await trendPOST(req("/api/trend", { method: "POST", body: "nope" }))).status).toBe(400)
    expect((await trendPOST(req("/api/trend", { method: "POST", body: JSON.stringify({ vaultId: "x" }) }))).status).toBe(400)
  })

  it("dedupes identical observations (deterministic id)", async () => {
    const vault = `dedup-${Date.now()}`
    const body1 = await (await trendPOST(req("/api/trend", { method: "POST", body: JSON.stringify({ vaultId: vault, navMicro: "100000000" }) }))).json()
    const body2 = await (await trendPOST(req("/api/trend", { method: "POST", body: JSON.stringify({ vaultId: vault, navMicro: "100000000" }) }))).json()
    expect(body1.deduped).toBe(false)
    expect(body2.deduped).toBe(true)
    expect(body2.observationId).toBe(body1.observationId)
  })
})

describe("x402 attestation route — REAL 402 -> 200 protocol", () => {
  it("returns HTTP 402 with a base64 X-PAYMENT-REQUIRED challenge on first call", async () => {
    const res = await x402GET(req("/api/x402/attestation?vault=credit"))
    expect(res.status).toBe(402)
    const header = res.headers.get("x-payment-required")!
    const challenge = JSON.parse(Buffer.from(header, "base64").toString("utf8"))
    expect(challenge.chainId).toBe(688689)
    expect(challenge.price).toBe("25000")
    expect(challenge.provider).toBe("CreditDefaultRiskFeed")
    expect(challenge.nonce).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it("400s on an unknown vault", async () => {
    const res = await x402GET(req("/api/x402/attestation?vault=bogus"))
    expect(res.status).toBe(400)
  })

  it("completes the paid replay with a REAL wallet signature and returns 200", async () => {
    // 1. get challenge
    const first = await x402GET(req("/api/x402/attestation?vault=credit"))
    const challenge = JSON.parse(Buffer.from(first.headers.get("x-payment-required")!, "base64").toString("utf8"))

    // 2. sign EIP-3009 TransferWithAuthorization with the USER's key
    const now = Math.floor(Date.now() / 1000)
    const signature = await account.signTypedData({
      domain: { name: "SentinelUSD", version: "1", chainId: 688689, verifyingContract: challenge.asset },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: account.address, to: challenge.recipient, value: BigInt(challenge.price),
        validAfter: BigInt(now - 60), validBefore: BigInt(now + 600), nonce: challenge.nonce,
      },
    })
    const idem = `test-${Date.now()}-${Math.random()}`
    const payment = {
      scheme: "exact",
      payload: { from: account.address, signature, validAfter: String(now - 60), validBefore: String(now + 600), nonce: challenge.nonce },
      idempotencyKey: idem,
      challengeNonce: challenge.nonce,
    }
    const second = await x402GET(req("/api/x402/attestation?vault=credit", {
      headers: { "x-payment": JSON.stringify(payment), "x-idempotency-key": idem },
    }))
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body.attestation.provider).toBe("CreditDefaultRiskFeed")
    expect(body.attestation.collateralRatioBps).toBe(10240)
    expect(body.attestation.serverSignature).toBeTruthy()
    expect(body.receiptHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(body.replayed).toBe(false)
    // cold-start seed replays the verified session (0.075 sUSDC spent), so the
    // first paid replay lands at 75000 + 25000 = 100000
    expect(body.sessionSpent).toBe("100000")
  })

  it("rejects a forged signature (wrong signer) with 402", async () => {
    const first = await x402GET(req("/api/x402/attestation?vault=tbill"))
    const challenge = JSON.parse(Buffer.from(first.headers.get("x-payment-required")!, "base64").toString("utf8"))
    const now = Math.floor(Date.now() / 1000)
    const forged = {
      scheme: "exact",
      payload: {
        from: account.address,
        signature: ("0x" + "00".repeat(65)) as `0x${string}`,
        validAfter: String(now - 60),
        validBefore: String(now + 600),
        nonce: challenge.nonce,
      },
      idempotencyKey: `forged-${Date.now()}`,
      challengeNonce: challenge.nonce,
    }
    const res = await x402GET(req("/api/x402/attestation?vault=tbill", {
      headers: { "x-payment": JSON.stringify(forged), "x-idempotency-key": forged.idempotencyKey },
    }))
    expect(res.status).toBe(402)
  })

  it("rejects expired challenges", async () => {
    const first = await x402GET(req("/api/x402/attestation?vault=harbor"))
    const challenge = JSON.parse(Buffer.from(first.headers.get("x-payment-required")!, "base64").toString("utf8"))
    const payment = {
      scheme: "exact",
      payload: { from: account.address, signature: "0x" + "11".repeat(65), validAfter: "0", validBefore: "1", nonce: challenge.nonce },
      idempotencyKey: `expired-${Date.now()}`,
      challengeNonce: challenge.nonce,
    }
    const res = await x402GET(req("/api/x402/attestation?vault=harbor", {
      headers: { "x-payment": JSON.stringify(payment), "x-idempotency-key": payment.idempotencyKey },
    }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toContain("expired")
  })

  it("rejects nonce reuse (replay protection)", async () => {
    const first = await x402GET(req("/api/x402/attestation?vault=credit"))
    const challenge = JSON.parse(Buffer.from(first.headers.get("x-payment-required")!, "base64").toString("utf8"))
    const now = Math.floor(Date.now() / 1000)
    const signature = await account.signTypedData({
      domain: { name: "SentinelUSD", version: "1", chainId: 688689, verifyingContract: challenge.asset },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: account.address, to: challenge.recipient, value: BigInt(challenge.price),
        validAfter: BigInt(now - 60), validBefore: BigInt(now + 600), nonce: challenge.nonce,
      },
    })
    const payment = {
      scheme: "exact",
      payload: { from: account.address, signature, validAfter: String(now - 60), validBefore: String(now + 600), nonce: challenge.nonce },
      idempotencyKey: `reuse-${Date.now()}`,
      challengeNonce: challenge.nonce,
    }
    const headers = { "x-payment": JSON.stringify(payment), "x-idempotency-key": payment.idempotencyKey }
    await x402GET(req("/api/x402/attestation?vault=credit", { headers }))
    const replay = await x402GET(req("/api/x402/attestation?vault=credit", { headers: { ...headers, "x-idempotency-key": `different-${Date.now()}` } }))
    expect(replay.status).toBe(402)
    expect((await replay.json()).error).toContain("nonce reuse")
  })

  it("serves idempotent replays for the SAME idempotency key", async () => {
    const first = await x402GET(req("/api/x402/attestation?vault=credit"))
    const challenge = JSON.parse(Buffer.from(first.headers.get("x-payment-required")!, "base64").toString("utf8"))
    const now = Math.floor(Date.now() / 1000)
    const signature = await account.signTypedData({
      domain: { name: "SentinelUSD", version: "1", chainId: 688689, verifyingContract: challenge.asset },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: account.address, to: challenge.recipient, value: BigInt(challenge.price),
        validAfter: BigInt(now - 60), validBefore: BigInt(now + 600), nonce: challenge.nonce,
      },
    })
    const idem = `idem-${Date.now()}`
    const payment = {
      scheme: "exact",
      payload: { from: account.address, signature, validAfter: String(now - 60), validBefore: String(now + 600), nonce: challenge.nonce },
      idempotencyKey: idem,
      challengeNonce: challenge.nonce,
    }
    const headers = { "x-payment": JSON.stringify(payment), "x-idempotency-key": idem }
    const r1 = await x402GET(req("/api/x402/attestation?vault=credit", { headers }))
    const body1 = await r1.json()
    const r2 = await x402GET(req("/api/x402/attestation?vault=credit", { headers }))
    const body2 = await r2.json()
    expect(r2.status).toBe(200)
    expect(body2.replayed).toBe(true)
    expect(body2.receiptHash).toBe(body1.receiptHash)
    expect(r2.headers.get("x-idempotent-replay")).toBe("true")
  })

  it("all 3 providers expose distinct challenges", async () => {
    const providers: string[] = []
    for (const v of ["tbill", "credit", "harbor"]) {
      const res = await x402GET(req(`/api/x402/attestation?vault=${v}`))
      const c = JSON.parse(Buffer.from(res.headers.get("x-payment-required")!, "base64").toString("utf8"))
      providers.push(c.provider)
      expect(res.status).toBe(402)
    }
    expect(new Set(providers).size).toBe(3)
    expect(providers).toEqual(["TBillReserveAuditor", "CreditDefaultRiskFeed", "ComplianceKyaVerifier"])
  })

  it("400s on malformed X-PAYMENT JSON", async () => {
    const res = await x402GET(req("/api/x402/attestation?vault=credit", { headers: { "x-payment": "{broken" } }))
    expect(res.status).toBe(400)
  })
})
