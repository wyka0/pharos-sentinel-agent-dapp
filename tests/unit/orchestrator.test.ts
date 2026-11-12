/**
 * tests/unit/orchestrator.test.ts — the SentinelAgentOrchestrator brain:
 * intent parsing + full pipeline behavior (offline RPC + mocked x402 fetch).
 */
import { describe, it, expect } from "vitest"
import { parseIntent, runSentinelPipeline, formatSusdc, buildTypedDataForBrowser } from "@/lib/agent/orchestrator"

const USER = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C" as const

describe("parseIntent — amounts", () => {
  it("parses '2,500 sUSDC'", () => {
    expect(parseIntent("Deposit 2,500 sUSDC for 30 days", USER).amount).toBe(2_500_000_000n)
  })
  it("parses '$2500' without unit", () => {
    expect(parseIntent("Deposit $2500 please", USER).amount).toBe(2_500_000_000n)
  })
  it("parses bare numbers as sUSDC", () => {
    expect(parseIntent("allocate 800", USER).amount).toBe(800_000_000n)
  })
  it("parses 5000 sUSDC at the policy cap", () => {
    expect(parseIntent("deposit 5000 sUSDC", USER).amount).toBe(5_000_000_000n)
  })
  it("parses 15000 sUSDC above the cap", () => {
    expect(parseIntent("deposit 15000 sUSDC", USER).amount).toBe(15_000_000_000n)
  })
  it("parses fractional amounts", () => {
    expect(parseIntent("put 10.5 sUSDC", USER).amount).toBe(10_500_000n)
  })
  it("yields 0n when no amount is present", () => {
    expect(parseIntent("what is the best venue?", USER).amount).toBe(0n)
  })
})

describe("parseIntent — horizons", () => {
  it("parses days", () => {
    expect(parseIntent("deposit 100 sUSDC for 45 days", USER).horizonDays).toBe(45)
  })
  it("parses weeks", () => {
    expect(parseIntent("deposit for 2 weeks", USER).horizonDays).toBe(14)
  })
  it("parses months", () => {
    expect(parseIntent("deposit for 6 months", USER).horizonDays).toBe(180)
  })
  it("parses years", () => {
    expect(parseIntent("deposit for 1 year", USER).horizonDays).toBe(365)
  })
  it("defaults to 30 days", () => {
    expect(parseIntent("deposit 100 sUSDC", USER).horizonDays).toBe(30)
  })
})

describe("parseIntent — risk ceiling", () => {
  it("defaults to moderate (60)", () => {
    expect(parseIntent("deposit 100 sUSDC", USER).riskCeiling).toBe(60)
  })
  it("lowers for conservative language", () => {
    expect(parseIntent("safe conservative deposit of 100 sUSDC", USER).riskCeiling).toBe(25)
  })
  it("raises for aggressive language", () => {
    expect(parseIntent("maximum yield, aggressive", USER).riskCeiling).toBe(90)
  })
  it("parses explicit numeric ceilings", () => {
    expect(parseIntent("deposit 100 sUSDC with risk ceiling 35", USER).riskCeiling).toBe(35)
  })
})

describe("parseIntent — venue & action", () => {
  it("detects the T-Bill vault", () => {
    expect(parseIntent("put funds in the T-Bill RWA vault", USER).requestedVault).toBe("tbill")
  })
  it("detects senior credit", () => {
    expect(parseIntent("allocate to private credit", USER).requestedVault).toBe("credit")
  })
  it("detects harbor buffer", () => {
    expect(parseIntent("use the harbor instant-liquidity buffer", USER).requestedVault).toBe("harbor")
  })
  it("detects allocate action", () => {
    expect(parseIntent("deposit 100 sUSDC", USER).action).toBe("allocate")
  })
  it("detects protective rebalance", () => {
    expect(parseIntent("rebalance and protect my position", USER).action).toBe("rebalance-protective")
  })
  it("defaults to analyze for questions", () => {
    expect(parseIntent("which vault is safest?", USER).action).toBe("analyze")
  })
  it("keeps the original prompt", () => {
    const p = "Deposit 2,500 sUSDC for 30 days"
    expect(parseIntent(p, USER).prompt).toBe(p)
  })
  it("honors overrides", () => {
    expect(parseIntent("deposit 100 sUSDC", USER, { riskCeiling: 10 }).riskCeiling).toBe(10)
  })
})

describe("pipeline — offline RPC (fail-closed behavior)", () => {
  it("always runs the 4-tool pipeline telemetry", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "analyze best venue for 800 sUSDC over 14 days", skipX402: true })
    const tools = new Set(out.pipeline.map((p) => p.tool))
    expect(tools.has("ChainMCP")).toBe(true)
    expect(tools.has("DocsMCP")).toBe(true)
    expect(tools.has("SkillEngine")).toBe(true)
  })
  it("Chain MCP reports read failure without crashing (fault isolation)", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "analyze 100 sUSDC", skipX402: true })
    const chain = out.pipeline.find((p) => p.call === "pharos_get_vault_states")!
    expect(chain.ok).toBe(false)
    expect(chain.summary).toContain("read failed")
  })
  it("Docs MCP still verifies specs offline", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "analyze 100 sUSDC", skipX402: true })
    const docs = out.pipeline.find((p) => p.tool === "DocsMCP")!
    expect(docs.ok).toBe(true)
    expect(docs.summary).toContain("citations")
  })
  it("SkillEngine notes fail-closed when no venue is readable", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "deposit 100 sUSDC", skipX402: true })
    const skill = out.pipeline.find((p) => p.tool === "SkillEngine")!
    expect(skill.summary).toContain("NONE (fail-closed)")
  })
  it("allocation requests are BLOCKED (fail-closed) when no venue data exists", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "deposit 100 sUSDC", skipX402: true })
    expect(out.status).toBe("blocked")
    expect(out.status === "blocked" && out.blocked.fundsAuthorized).toBe(0)
  })
  it("analyze requests return an advisory (no funds authorized)", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "which venue has the best net yield?", skipX402: true })
    expect(out.status).toBe("advisory")
  })
})

describe("pipeline — x402 phase 1 (mocked 402 challenge)", () => {
  const challenge = {
    x402Version: 1, scheme: "exact", price: "25000",
    asset: "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b",
    recipient: "0x4bf82bc533befdafa0a0d2154842394b37a40ea1",
    nonce: ("0x" + "22".repeat(32)) as `0x${string}`,
    chainId: 688689, expiry: Math.floor(Date.now() / 1000) + 900,
    resource: "/api/x402/attestation", description: "audit", provider: "CreditDefaultRiskFeed",
  }
  const fetch402 = (async () => new Response("payment required", { status: 402, headers: { "x-payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") } })) as unknown as typeof fetch

  it("returns payment_required with typed data for the USER's wallet", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "deposit 2500 sUSDC", fetchImpl: fetch402 })
    expect(out.status).toBe("payment_required")
    const payment = out.status === "payment_required" ? out.payment : null
    expect(payment?.vaultKey).toBe("credit")
    expect(payment?.challengeSummary.price).toBe("25000")
    expect((payment?.typedDataToSign as any).primaryType).toBe("TransferWithAuthorization")
  })
  it("logs the challenge as an X402 pipeline step", async () => {
    const out = await runSentinelPipeline({ user: USER, prompt: "deposit 2500 sUSDC", fetchImpl: fetch402 })
    const x = out.pipeline.find((p) => p.tool === "X402")!
    expect(x.summary).toContain("challenge received")
    expect(x.summary).toContain("awaiting USER signature")
  })
})

describe("pipeline — x402 phase 2 (signed payment provided)", () => {
  it("binds the receipt hash and proceeds to guarded execution prep", async () => {
    const out = await runSentinelPipeline({
      user: USER,
      prompt: "deposit 2500 sUSDC for 30 days",
      skipX402: false,
      x402SignedPayment: {
        vaultKey: "credit",
        headerJson: "",
        idempotencyKey: "idem-test-1",
        receiptHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
        attestation: { provider: "CreditDefaultRiskFeed", collateralRatioBps: 10240 },
      },
    })
    const x = out.pipeline.find((p) => p.tool === "X402")!
    expect(x.ok).toBe(true)
    expect(x.summary).toContain("receiptHash=0x")
    expect(x.summary).toContain("fee=0.025 sUSDC")
  })
})

describe("helpers", () => {
  it("formatSusdc renders 6-decimal sUSDC", () => {
    expect(formatSusdc(2_500_000_000n)).toBe("2500.00")
    expect(formatSusdc(16_780_821n)).toBe("16.78")
    expect(formatSusdc(0n)).toBe("0.00")
  })
  it("formatSusdc handles negative values", () => {
    expect(formatSusdc(-1_500_000n)).toBe("-1.50")
  })
  it("buildTypedDataForBrowser shapes the EIP-712 payload", () => {
    const td = buildTypedDataForBrowser(
      { asset: "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b", chainId: 688689, recipient: "0x4bf82bc533befdafa0a0d2154842394b37a40ea1", nonce: ("0x" + "33".repeat(32)) as `0x${string}`, price: "25000", expiry: Math.floor(Date.now() / 1000) + 900 },
      USER,
    )
    expect((td as any).message.from).toBe(USER)
    expect((td as any).message.value).toBe("25000")
    expect((td as any).domain.chainId).toBe(688689)
  })
})

describe("trend observations injection (scenario 4 prep)", () => {
  it("records injected observations and reports SPIKE_REJECTED", async () => {
    const out = await runSentinelPipeline({
      user: USER,
      prompt: "analyze harbor buffer",
      skipX402: true,
      trendObservations: [
        { vaultId: "harbor", navMicro: 100_000_000n },
        { vaultId: "harbor", navMicro: 93_000_000n },
        { vaultId: "harbor", navMicro: 100_000_000n },
      ],
    })
    const skill = out.pipeline.find((p) => p.tool === "SkillEngine")!
    expect(skill.summary).toContain("spike-rejected")
  })
  it("reports confirmed trends for 3-drop windows", async () => {
    const out = await runSentinelPipeline({
      user: USER,
      prompt: "rebalance and protect harbor",
      skipX402: true,
      trendObservations: [
        { vaultId: "harbor", navMicro: 100_000_000n },
        { vaultId: "harbor", navMicro: 98_000_000n },
        { vaultId: "harbor", navMicro: 95_000_000n },
        { vaultId: "harbor", navMicro: 92_000_000n },
      ],
    })
    const skill = out.pipeline.find((p) => p.tool === "SkillEngine")!
    expect(skill.summary).toContain("confirmed")
  })
})
