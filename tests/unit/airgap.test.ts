/**
 * tests/unit/airgap.test.ts — Requirement 04 canary: zero key material in
 * src/, non-custodial bundle completeness, and secret hygiene of tracked files.
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { buildAllocationBundle, runSentinelPipeline } from "@/lib/agent/orchestrator"
import { runPolicyGuards, DEFAULT_POLICY } from "@/lib/agent/policy"

const ROOT = path.resolve(__dirname, "../..")
const SRC = path.join(ROOT, "src")

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const srcFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f))

describe("airgap — no key material anywhere in src/", () => {
  it("src/ contains TypeScript files to scan (sanity)", () => {
    expect(srcFiles.length).toBeGreaterThan(10)
  })

  it("never imports or calls privateKeyToAccount (prose mentions allowed)", () => {
    const re = /import\s+[^;]*privateKeyToAccount|privateKeyToAccount\s*\(/
    const offenders = srcFiles.filter((f) => re.test(fs.readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
  })

  it("never contains a non-zero hex-encoded 32-byte key literal", () => {
    // all-zero hash literals are sentinel placeholders, not secrets
    const re = /0x[a-fA-F0-9]{64}/g
    const offenders = srcFiles.filter((f) => {
      const matches = fs.readFileSync(f, "utf8").match(re) ?? []
      return matches.some((m) => !/^0x0+$/.test(m))
    })
    expect(offenders).toEqual([])
  })

  it("never uses mnemonic APIs (prose mentions allowed)", () => {
    const re = /mnemonic\s*[:=]|fromMnemonic|generateMnemonic|validateMnemonic/i
    const offenders = srcFiles.filter((f) => re.test(fs.readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
  })

  it("never reads TEST_USER_PRIVATE_KEY from process.env", () => {
    const offenders = srcFiles.filter((f) => fs.readFileSync(f, "utf8").includes("TEST_USER_PRIVATE_KEY"))
    expect(offenders).toEqual([])
  })

  it("scripts/ MAY reference the key env var (negative control)", () => {
    const lib = fs.readFileSync(path.join(ROOT, "scripts", "lib.ts"), "utf8")
    expect(lib).toContain("TEST_USER_PRIVATE_KEY")
  })

  it(".env.local is listed in .gitignore", () => {
    const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")
    expect(gi).toContain(".env.local")
    expect(gi).toContain(".env.*")
  })

  it(".env.example exists with only the all-zero placeholder key", () => {
    const ex = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8")
    expect(ex).toContain("TEST_USER_PRIVATE_KEY=0x0000")
    const hexes = ex.match(/0x[a-fA-F0-9]{60,}/g) ?? []
    expect(hexes.every((h) => /^0x0+$/.test(h))).toBe(true)
  })
})

describe("non-custodial Prepared Action Bundle completeness", () => {
  const receipt = ("0x" + "ab".repeat(32)) as `0x${string}`
  const bundle = buildAllocationBundle({
    user: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C" as `0x${string}`,
    vault: "0x28080450b7be3963f55296ea9f2b45ad9af1b720" as `0x${string}`,
    vaultLabel: "Atlantic Senior Credit Pool",
    amount: 2_500_000_000n,
    minSharesOut: 2_400_000_000n,
    x402ReceiptHash: receipt,
    digest: ("0x" + "cd".repeat(32)) as `0x${string}`,
    policyReport: runPolicyGuards({
      amount: 2_500_000_000n,
      vaultAddress: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
      vaultWhitelisted: true,
      vaultPaused: false,
      x402ReceiptHash: receipt,
      minSharesOut: 2_400_000_000n,
      quotedShares: 2_495_000_000n,
      policy: DEFAULT_POLICY,
    }),
    susdc: "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b" as `0x${string}`,
    firewall: "0x4bf82bc533befdafa0a0d2154842394b37a40ea1" as `0x${string}`,
  })

  it("targets the Policy Firewall contract (not a vault directly)", () => {
    expect(bundle.to).toBe("0x4bf82bc533befdafa0a0d2154842394b37a40ea1")
  })
  it("carries raw calldata for executeGuardedAllocation", () => {
    expect(bundle.data.startsWith("0x")).toBe(true)
    // 4-byte selector + 5 x 32-byte args (address padded, 3x uint256, 2x bytes32)
    expect(bundle.data.length).toBeGreaterThanOrEqual(10 + 64 * 5 - 24) // address arg only pads to 64 total
  })
  it("has zero msg.value (non-custodial, no native attached)", () => {
    expect(bundle.value).toBe("0")
  })
  it("pins chainId 688689", () => {
    expect(bundle.chainId).toBe(688689)
  })
  it("embeds the policy check report with 5 passing guards", () => {
    expect(bundle.policyCheckReport.passed).toBe(true)
    expect(bundle.policyCheckReport.outcomes).toHaveLength(5)
  })
  it("binds the x402 receipt hash", () => {
    expect(bundle.x402ReceiptHash).toBe(receipt)
  })
  it("binds the agent intent digest", () => {
    expect(bundle.agentIntentDigest).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it("includes the exact-amount sUSDC approval step first", () => {
    expect(bundle.approvals).toHaveLength(1)
    expect(bundle.approvals[0].summary).toContain("approve SentinelPolicyFirewall")
    expect(bundle.approvals[0].to).toBe("0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b")
  })
  it("exposes a PharosScan preview link", () => {
    expect(bundle.explorerTxPreview).toContain("atlantic.pharosscan.xyz")
  })
})

describe("agent outcome safety invariants", () => {
  it("blocked outcomes authorize 0 funds", async () => {
    const out = await runSentinelPipeline({ user: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C" as `0x${string}`, prompt: "deposit 100 sUSDC", skipX402: true })
    expect(out.status).toBe("blocked")
    if (out.status === "blocked") {
      expect(out.blocked.fundsAuthorized).toBe(0)
      expect(out.blocked.policyCheckReport.passed).toBe(false)
    }
  })
  it("bundles are only produced after policy guards pass", async () => {
    const out = await runSentinelPipeline({ user: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C" as `0x${string}`, prompt: "analyze", skipX402: true })
    if (out.status === "prepared") {
      expect(out.bundle.policyCheckReport.passed).toBe(true)
    } else {
      expect(out.status).not.toBe("prepared")
    }
  })
})
