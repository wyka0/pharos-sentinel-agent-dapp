/**
 * tests/unit/chain-mcp.test.ts — Tool #1 structure & fault isolation
 * (offline RPC: every tool must degrade gracefully, never throw).
 */
import { describe, it, expect } from "vitest"
import {
  pharos_get_vault_states,
  pharos_get_user_portfolio,
  pharos_get_policy_config,
  pharos_simulate_guarded_tx,
  reasonLabel,
  keccakOf,
  gentleDilutionApyBps,
  type VaultState,
} from "@/lib/mcp/chain-mcp"

const USER = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C" as const

describe("gentleDilutionApyBps — effective-APY normalizer", () => {
  it("converts base 1045 bps at 42% utilization into 983 bps (9.83%)", () => {
    // 1045 × (10000 − 4200×1400/10000)/10000 = 1045 × 9412/10000 = 983.55 → 983
    expect(gentleDilutionApyBps(1045n, 4200n)).toBe(983n)
  })
  it("is the identity at zero utilization", () => {
    expect(gentleDilutionApyBps(1045n, 0n)).toBe(1045n)
  })
  it("caps the drag at 100% utilization (14% total reduction, never negative)", () => {
    // 1045 × 8600/10000 = 898.7 → 898
    expect(gentleDilutionApyBps(1045n, 10_000n)).toBe(898n)
  })
  it("stays monotonic in utilization and never exceeds base", () => {
    expect(gentleDilutionApyBps(1045n, 4200n)).toBeLessThanOrEqual(1045n)
    expect(gentleDilutionApyBps(1045n, 8600n)).toBeLessThanOrEqual(gentleDilutionApyBps(1045n, 4200n))
  })
})

describe("pharos_get_vault_states — fault isolation", () => {
  it("returns a structured MCP result even when RPC is unreachable", async () => {
    const r = await pharos_get_vault_states()
    expect(r.tool).toBe("pharos_get_vault_states")
    expect(r.chainId).toBe(688689)
    expect(typeof r.latencyMs).toBe("number")
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
  it("never throws on connection refused", async () => {
    await expect(pharos_get_vault_states()).resolves.toBeTruthy()
  })
})

describe("pharos_get_user_portfolio — graceful degradation", () => {
  it("returns an MCP envelope with error info offline", async () => {
    const r = await pharos_get_user_portfolio(USER)
    expect(r.tool).toBe("pharos_get_user_portfolio")
    expect(r.ok).toBe(false)
  })
  it("never throws offline", async () => {
    await expect(pharos_get_user_portfolio(USER)).resolves.toBeTruthy()
  })
})

describe("pharos_get_policy_config — graceful degradation", () => {
  it("returns ok:false offline without throwing", async () => {
    const r = await pharos_get_policy_config(USER)
    expect(r.tool).toBe("pharos_get_policy_config")
    expect(r.ok).toBe(false)
  })
})

describe("pharos_simulate_guarded_tx — graceful degradation", () => {
  it("returns ok:false offline", async () => {
    const r = await pharos_simulate_guarded_tx({
      user: USER,
      vault: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
      amount: 1_000_000n,
      minSharesOut: 900_000n,
      x402ReceiptHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    })
    expect(r.tool).toBe("pharos_simulate_guarded_tx")
    expect(r.ok).toBe(false)
  })
})

describe("VaultState semantics (type contract)", () => {
  it("degraded vault state carries the error and healthy=false", () => {
    const degraded: VaultState = {
      id: "harbor", label: "Harbor", address: "0x1", kind: "DeFi",
      symbol: null, totalAssets: null, totalSupplyShares: null, navPerShare: null,
      baseApyBps: null, effectiveApyBps: null, entryFeeBps: null, exitFeeBps: null,
      kyaCollateralRatioBps: null, paused: null, circuitBreakerTripped: null,
      utilizationBps: null, latestAuditHash: null, x402AttestationRequired: false,
      healthy: false, degraded: true, error: "read failed",
    }
    expect(degraded.degraded).toBe(true)
    expect(degraded.healthy).toBe(false)
  })
  it("healthy vault state is not degraded", () => {
    const ok: VaultState = {
      id: "tbill", label: "T-Bill", address: "0x2", kind: "RWA",
      symbol: "pTBILL", totalAssets: 1n, totalSupplyShares: 1n, navPerShare: 1,
      baseApyBps: 815n, effectiveApyBps: 815n, entryFeeBps: 0n, exitFeeBps: 0n,
      kyaCollateralRatioBps: 10280n, paused: false, circuitBreakerTripped: false,
      utilizationBps: null, latestAuditHash: null, x402AttestationRequired: false,
      healthy: true, degraded: false,
    }
    expect(ok.healthy).toBe(true)
    expect(ok.degraded).toBe(false)
  })
})

describe("guard reason label resolution", () => {
  it("keccakOf produces canonical hashes for the 5 custom errors", () => {
    for (const reason of ["ExceedsPolicySpendCap", "UnwhitelistedTargetVault", "MissingX402AuditAttestation", "SlippageExceeded", "FirewallPaused"]) {
      expect(keccakOf(reason)).toMatch(/^0x[0-9a-f]{64}$/)
    }
  })
  it("maps a guard hash back to its label", () => {
    expect(reasonLabel(keccakOf("ExceedsPolicySpendCap"))).toBe("ExceedsPolicySpendCap")
    expect(reasonLabel(keccakOf("UnwhitelistedTargetVault"))).toBe("UnwhitelistedTargetVault")
    expect(reasonLabel(keccakOf("MissingX402AuditAttestation"))).toBe("MissingX402AuditAttestation")
    expect(reasonLabel(keccakOf("SlippageExceeded"))).toBe("SlippageExceeded")
    expect(reasonLabel(keccakOf("FirewallPaused"))).toBe("FirewallPaused")
  })
  it("returns NONE for the zero hash (guards passed)", () => {
    expect(reasonLabel("0x0000000000000000000000000000000000000000000000000000000000000000")).toBe("NONE")
  })
  it("returns Unknown for unrecognized hashes", () => {
    expect(reasonLabel(keccakOf("SomethingElse"))).toBe("Unknown")
  })
  it("guard hashes are unique", () => {
    const hashes = ["ExceedsPolicySpendCap", "UnwhitelistedTargetVault", "MissingX402AuditAttestation", "SlippageExceeded", "FirewallPaused"].map(keccakOf)
    expect(new Set(hashes).size).toBe(5)
  })
})
