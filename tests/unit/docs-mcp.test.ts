/**
 * tests/unit/docs-mcp.test.ts — Tool #2: spec lookup + invariant verification.
 */
import { describe, it, expect } from "vitest"
import {
  pharos_docs_lookup_spec,
  pharos_docs_verify_abi_invariants,
  citationFor,
  SPEC_CORPUS,
} from "@/lib/mcp/docs-mcp"

describe("spec corpus integrity", () => {
  it("indexes the Pharos Atlantic network spec", () => {
    expect(SPEC_CORPUS.find((s) => s.id === "pharos:network:atlantic")).toBeDefined()
  })
  it("indexes ERC-4626 share conversion spec", () => {
    expect(SPEC_CORPUS.find((s) => s.id === "erc-4626:shares")).toBeDefined()
  })
  it("indexes the x402/EIP-3009 spec", () => {
    expect(SPEC_CORPUS.find((s) => s.id === "x402:http402")).toBeDefined()
  })
  it("indexes the Policy Firewall invariants spec", () => {
    expect(SPEC_CORPUS.find((s) => s.id === "sentinel:policy-firewall")).toBeDefined()
  })
  it("indexes the agent airgap spec", () => {
    expect(SPEC_CORPUS.find((s) => s.id === "sentinel:agent-airgap")).toBeDefined()
  })
  it("pins chainId 688689 in the network spec content", () => {
    expect(SPEC_CORPUS.find((s) => s.id === "pharos:network:atlantic")!.content).toContain("688689")
  })
  it("every spec has invariants with tests", () => {
    for (const s of SPEC_CORPUS) {
      expect(s.invariants.length).toBeGreaterThan(0)
      for (const inv of s.invariants) {
        expect(inv.id).toBeTruthy()
        expect(inv.statement).toBeTruthy()
        expect(inv.test).toBeTruthy()
      }
    }
  })
  it("has unique spec ids", () => {
    expect(new Set(SPEC_CORPUS.map((s) => s.id)).size).toBe(SPEC_CORPUS.length)
  })
})

describe("pharos_docs_lookup_spec", () => {
  it("finds a spec by exact id", async () => {
    const r = await pharos_docs_lookup_spec("erc-4626:shares")
    expect(r.ok).toBe(true)
    expect(r.spec?.title).toContain("ERC-4626")
  })
  it("finds a spec by topic substring", async () => {
    const r = await pharos_docs_lookup_spec("x402")
    expect(r.ok).toBe(true)
    expect(r.spec?.id).toBe("x402:http402")
  })
  it("finds a spec by title substring (case-insensitive)", async () => {
    const r = await pharos_docs_lookup_spec("ATLANTIC")
    expect(r.ok).toBe(true)
    expect(r.spec?.id).toBe("pharos:network:atlantic")
  })
  it("returns ok:false with allSpecIds for unknown topics", async () => {
    const r = await pharos_docs_lookup_spec("nonexistent-spec-xyz")
    expect(r.ok).toBe(false)
    expect(r.allSpecIds).toContain("sentinel:policy-firewall")
    expect(r.error).toContain("nonexistent-spec-xyz")
  })
  it("measures latency", async () => {
    const r = await pharos_docs_lookup_spec("erc-4626:shares")
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })
  it("reports the tool name", async () => {
    expect((await pharos_docs_lookup_spec("erc-4626:shares")).tool).toBe("pharos_docs_lookup_spec")
  })
})

describe("pharos_docs_verify_abi_invariants — network spec", () => {
  it("passes when chainId is 688689", async () => {
    const r = await pharos_docs_verify_abi_invariants("pharos:network:atlantic", { chainId: 688689, explorer: "https://atlantic.pharosscan.xyz" })
    expect(r.ok).toBe(true)
    expect(r.summary).toEqual({ passed: 2, total: 2 })
  })
  it("fails NET-1 on a wrong chainId", async () => {
    const r = await pharos_docs_verify_abi_invariants("pharos:network:atlantic", { chainId: 1, explorer: "https://atlantic.pharosscan.xyz" })
    expect(r.checks!.find((c) => c.invariantId === "NET-1")!.passed).toBe(false)
  })
  it("fails NET-2 on a foreign explorer", async () => {
    const r = await pharos_docs_verify_abi_invariants("pharos:network:atlantic", { chainId: 688689, explorer: "https://etherscan.io" })
    expect(r.checks!.find((c) => c.invariantId === "NET-2")!.passed).toBe(false)
  })
})

describe("pharos_docs_verify_abi_invariants — erc-4626 spec", () => {
  it("passes all invariants for healthy vault data", async () => {
    const r = await pharos_docs_verify_abi_invariants("erc-4626:shares", {
      chainId: 688689,
      previewDepositReturns: true,
      convertToAssetsOfShares: 1_000_000n,
      rawAssets: 1_000_000n,
      accountedYield: 500n,
      yieldReserveBackstop: 5_000_000_000n,
      navBefore: 1.0,
      navAfter: 1.00002,
    })
    expect(r.ok).toBe(true)
    expect(r.summary!.total).toBe(4)
  })
  it("fails ERC4626-2 when converted assets exceed raw assets (inflation)", async () => {
    const r = await pharos_docs_verify_abi_invariants("erc-4626:shares", {
      previewDepositReturns: true,
      convertToAssetsOfShares: 2_000_000n,
      rawAssets: 1_000_000n,
    })
    expect(r.checks!.find((c) => c.invariantId === "ERC4626-2")!.passed).toBe(false)
  })
  it("fails ERC4626-3 when yield is not backed by reserve", async () => {
    const r = await pharos_docs_verify_abi_invariants("erc-4626:shares", {
      previewDepositReturns: true,
      convertToAssetsOfShares: 1n,
      rawAssets: 1n,
      accountedYield: 9_999n,
      yieldReserveBackstop: 100n,
    })
    expect(r.checks!.find((c) => c.invariantId === "ERC4626-3")!.passed).toBe(false)
  })
  it("fails ERC4626-4 when NAV decreases", async () => {
    const r = await pharos_docs_verify_abi_invariants("erc-4626:shares", {
      previewDepositReturns: true,
      convertToAssetsOfShares: 1n,
      rawAssets: 1n,
      navBefore: 1.5,
      navAfter: 1.4,
    })
    expect(r.checks!.find((c) => c.invariantId === "ERC4626-4")!.passed).toBe(false)
  })
})

describe("pharos_docs_verify_abi_invariants — x402 spec", () => {
  it("passes all 5 payment invariants", async () => {
    const r = await pharos_docs_verify_abi_invariants("x402:http402", {
      roiPassed: true,
      budgetPassed: true,
      signerIsUser: true,
      nonceUnused: true,
      challengeNotExpired: true,
      receiptHashMatches: true,
    })
    expect(r.ok).toBe(true)
    expect(r.summary).toEqual({ passed: 5, total: 5 })
  })
  it("fails X402-1 when ROI gate fails even with budget ok", async () => {
    const r = await pharos_docs_verify_abi_invariants("x402:http402", { roiPassed: false, budgetPassed: true })
    expect(r.checks!.find((c) => c.invariantId === "X402-1")!.passed).toBe(false)
  })
  it("fails X402-2 when the signer is not the user (custodial violation)", async () => {
    const r = await pharos_docs_verify_abi_invariants("x402:http402", { roiPassed: true, budgetPassed: true, signerIsUser: false })
    expect(r.ok).toBe(false)
  })
  it("fails X402-3 on nonce reuse", async () => {
    const r = await pharos_docs_verify_abi_invariants("x402:http402", { roiPassed: true, budgetPassed: true, signerIsUser: true, nonceUnused: false })
    expect(r.checks!.find((c) => c.invariantId === "X402-3")!.passed).toBe(false)
  })
  it("fails X402-4 on expired challenges", async () => {
    const r = await pharos_docs_verify_abi_invariants("x402:http402", { roiPassed: true, budgetPassed: true, signerIsUser: true, nonceUnused: true, challengeNotExpired: false })
    expect(r.ok).toBe(false)
  })
  it("fails X402-5 on receipt hash tampering", async () => {
    const r = await pharos_docs_verify_abi_invariants("x402:http402", { roiPassed: true, budgetPassed: true, signerIsUser: true, nonceUnused: true, challengeNotExpired: true, receiptHashMatches: false })
    expect(r.ok).toBe(false)
  })
})

describe("pharos_docs_verify_abi_invariants — firewall spec", () => {
  it("verifies a passing allocation", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:policy-firewall", {
      amount: 2_500_000_000n,
      maxPerTxSpend: 5_000_000_000n,
      vaultWhitelisted: true,
      x402ReceiptHash: "0x" + "ab".repeat(32),
      minSharesOut: 100n,
      quotedShares: 200n,
      intentDigestUnused: true,
      eventEmitted: true,
    })
    expect(r.ok).toBe(true)
  })
  it("fails FW-1 when amount exceeds cap", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:policy-firewall", { amount: 15_000_000_000n, maxPerTxSpend: 5_000_000_000n })
    expect(r.checks!.find((c) => c.invariantId === "FW-1")!.passed).toBe(false)
  })
  it("fails FW-2 for unwhitelisted vault", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:policy-firewall", { vaultWhitelisted: false })
    expect(r.checks!.find((c) => c.invariantId === "FW-2")!.passed).toBe(false)
  })
  it("fails FW-3 for zero receipt hash", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:policy-firewall", { x402ReceiptHash: "0x" + "0".repeat(64) })
    expect(r.checks!.find((c) => c.invariantId === "FW-3")!.passed).toBe(false)
  })
  it("fails FW-4 on slippage breach", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:policy-firewall", { minSharesOut: 300n, quotedShares: 200n })
    expect(r.checks!.find((c) => c.invariantId === "FW-4")!.passed).toBe(false)
  })
  it("fails FW-5 on replayed intent digest", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:policy-firewall", { intentDigestUnused: false })
    expect(r.checks!.find((c) => c.invariantId === "FW-5")!.passed).toBe(false)
  })
  it("fails FW-6 when event missing", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:policy-firewall", { eventEmitted: false })
    expect(r.checks!.find((c) => c.invariantId === "FW-6")!.passed).toBe(false)
  })
})

describe("pharos_docs_verify_abi_invariants — airgap spec", () => {
  it("verifies a clean airgap", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:agent-airgap", { srcHasSecrets: false, bundleComplete: true })
    expect(r.ok).toBe(true)
  })
  it("fails AG-1 when secrets exist in src/", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:agent-airgap", { srcHasSecrets: true, bundleComplete: true })
    expect(r.ok).toBe(false)
  })
  it("fails AG-2 for incomplete bundles", async () => {
    const r = await pharos_docs_verify_abi_invariants("sentinel:agent-airgap", { srcHasSecrets: false, bundleComplete: false })
    expect(r.ok).toBe(false)
  })
})

describe("errors & citations", () => {
  it("errors on unknown spec id", async () => {
    const r = await pharos_docs_verify_abi_invariants("bogus", {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain("bogus")
  })
  it("citationFor produces a [Docs MCP] citation line", () => {
    const c = citationFor("erc-4626:shares")
    expect(c).toContain("[Docs MCP]")
    expect(c).toContain("erc-4626:shares")
    expect(c).toContain("eips.ethereum.org")
  })
  it("citationFor handles unknown ids gracefully", () => {
    expect(citationFor("nope")).toContain("unknown spec")
  })
  it("every verify result measures latency and names the tool", async () => {
    const r = await pharos_docs_verify_abi_invariants("pharos:network:atlantic", { chainId: 688689 })
    expect(r.tool).toBe("pharos_docs_verify_abi_invariants")
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })
})
