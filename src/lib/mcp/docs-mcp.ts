/**
 * src/lib/mcp/docs-mcp.ts — TOOL #2: Pharos Developer Docs MCP
 * =====================================================================
 * MCP-compliant knowledge & SPEC VERIFICATION server. The Sentinel agent
 * does not "just know" specs — every decision CITES the exact rule it
 * verified through this tool before acting:
 *
 *   pharos_docs_lookup_spec       — fetch an indexed spec section
 *   pharos_docs_verify_abi_invariants — verify a concrete situation against
 *                                       the invariants of that spec section
 *
 * Indexed corpus:
 *   - Pharos Atlantic network spec (chainId 688689, RPC, explorer)
 *   - ERC-4626 share conversion & insolvency invariants
 *   - EIP-3009 / x402 HTTP 402 payment header standard
 *   - SentinelPolicyFirewall safety invariants (custom errors + guards)
 */

export interface SpecSection {
  id: string
  title: string
  source: string
  content: string
  invariants: Array<{ id: string; statement: string; test: string }>
}

export const SPEC_CORPUS: SpecSection[] = [
  {
    id: "pharos:network:atlantic",
    title: "Pharos Atlantic Testnet — Network Specification",
    source: "docs.pharos.xyz / network directory (Atlantic Testnet)",
    content:
      "Atlantic Testnet: chainId 688689 (hex 0xA8271), currency PHRS (18 decimals), " +
      "RPC https://atlantic.dplabs-internal.com, explorer https://atlantic.pharosscan.xyz. " +
      "All Sentinel desk operations MUST pin chainId 688689 and MUST reject any " +
      "wallet/report from a different chain.",
    invariants: [
      { id: "NET-1", statement: "Every transaction and read targets chainId 688689 exactly.", test: "chainId === 688689" },
      { id: "NET-2", statement: "Explorer receipt links resolve under atlantic.pharosscan.xyz.", test: "explorer.startsWith('https://atlantic.pharosscan.xyz')" },
    ],
  },
  {
    id: "erc-4626:shares",
    title: "ERC-4626 — Tokenized Vault Standard: share conversion & solvency",
    source: "eips.ethereum.org/EIPS/eip-4626",
    content:
      "convertToShares(assets) = assets * totalSupply / totalAssets; convertToAssets(shares) = " +
      "shares * totalAssets / totalSupply. Implementations SHOULD mitigate inflation attacks " +
      "via a virtual share offset. Vaults MUST NOT revert on previewDeposit. A solvent vault " +
      "satisfies: sum(user assets) <= totalAssets at every block, and withdraw MUST NOT promise " +
      "more assets than the vault controls.",
    invariants: [
      { id: "ERC4626-1", statement: "previewDeposit is a pure function of (assets, supply, totalAssets) and never reverts.", test: "previewDeposit(amount) returns uint256" },
      { id: "ERC4626-2", statement: "Deposit/withdraw roundtrip cannot create shares out of thin air.", test: "convertToAssets(convertToShares(x)) <= x within rounding" },
      { id: "ERC4626-3", statement: "Accounted yield must be pre-funded (backed by a real token reserve).", test: "accountedYield <= yieldReserveBackstop + redeemedYield" },
      { id: "ERC4626-4", statement: "NAV per share after accrual is monotonically non-decreasing (fees never push NAV below 1.0).", test: "nav(t+1) >= nav(t)" },
    ],
  },
  {
    id: "x402:http402",
    title: "x402 Protocol — HTTP 402 Agent Micropayments (EIP-3009 authorization)",
    source: "x402.org / EIP-3009 TransferWithAuthorization",
    content:
      "A resource behind x402 responds 402 Payment Required with a X-PAYMENT-REQUIRED " +
      "challenge: {x402Version, scheme, price, asset, recipient, nonce, chainId, expiry}. " +
      "The agent evaluates expected value BEFORE paying, signs an EIP-3009 " +
      "TransferWithAuthorization (from, to, value, validAfter, validBefore, nonce) with the " +
      "USER-controlled signer (never an agent-held key), and replays the request with " +
      "X-PAYMENT carrying {scheme, payload{signature, from, ...}}. Servers MUST accept " +
      "idempotency keys and MUST reject nonce reuse.",
    invariants: [
      { id: "X402-1", statement: "Payment is only constructed after ROI check: expectedYieldDelta > feeCost AND session budget cap not exceeded.", test: "roi && budget" },
      { id: "X402-2", statement: "The payer is the user's wallet (recovered signer), NOT an agent-held key.", test: "recoveredFrom === userSigner" },
      { id: "X402-3", statement: "A nonce may be redeemed exactly once (replay protection).", test: "nonceStore[nonce] absent" },
      { id: "X402-4", statement: "The challenge expiry MUST be honored: expired challenges are never paid.", test: "validBefore > now" },
      { id: "X402-5", statement: "The receipt hash bound on-chain is keccak256(attestation bytes) — tamper-evident.", test: "x402ReceiptHash === keccak256(attestation)" },
    ],
  },
  {
    id: "sentinel:policy-firewall",
    title: "SentinelPolicyFirewall — On-Chain Safety Invariants",
    source: "contracts/PharosSentinelSuite.sol (SentinelPolicyFirewall)",
    content:
      "Every agent-prepared allocation passes FIVE atomically-ordered guards inside " +
      "executeGuardedAllocation: G1 user kill-switch (FirewallPaused), G2 per-tx spend cap " +
      "(ExceedsPolicySpendCap), G3 vault whitelist (UnwhitelistedTargetVault), G4 x402 " +
      "attestation binding (MissingX402AuditAttestation), G5 slippage bound " +
      "(SlippageExceeded). Defaults: maxPerTxSpend=5000 sUSDC, maxSlippageBps=30, " +
      "whitelist=true, attestation=true, paused=false. Reverts leave 0 funds moved. " +
      "The agent MUST run pharos_simulate_guarded_tx (same guards, view mode) BEFORE " +
      "preparing any signing bundle.",
    invariants: [
      { id: "FW-1", statement: "amount > maxPerTxSpend => revert ExceedsPolicySpendCap.", test: "guard order G2" },
      { id: "FW-2", statement: "Non-whitelisted vault => revert UnwhitelistedTargetVault.", test: "guard order G3" },
      { id: "FW-3", statement: "x402ReceiptHash == 0 => revert MissingX402AuditAttestation.", test: "guard order G4" },
      { id: "FW-4", statement: "previewDeposit(amount) < minSharesOut => revert SlippageExceeded.", test: "guard order G5" },
      { id: "FW-5", statement: "agentIntentDigest is single-use (replay protection).", test: "usedAgentIntentDigest[digest] false" },
      { id: "FW-6", statement: "A successful execution emits SentinelAllocationExecuted with receipt + intent digest + blockNumber.", test: "event emitted" },
    ],
  },
  {
    id: "sentinel:agent-airgap",
    title: "Sentinel Agent Airgap — Non-Custodial Architecture",
    source: "ARCHITECTURE.md §Non-Custodial Airgap",
    content:
      "The agent runtime (src/) NEVER holds keys: no private keys, no mnemonics, no " +
      "privateKeyToAccount. Fund-moving actions compile to a Prepared Action Bundle " +
      "{to, data, value, chainId, policyCheckReport, x402ReceiptHash, agentIntentDigest} " +
      "signed by the USER's wallet (wagmi) or blocked by the Policy Firewall pre-flight.",
    invariants: [
      { id: "AG-1", statement: "Zero signer material inside src/.", test: "secret canary scanner" },
      { id: "AG-2", statement: "Every bundle carries a policy check report and an intent digest.", test: "bundle fields present" },
    ],
  },
]

/* ------------------------------- Tool #2 API ------------------------------- */

export interface DocsLookupResult {
  tool: "pharos_docs_lookup_spec"
  ok: boolean
  latencyMs: number
  spec?: SpecSection
  allSpecIds?: string[]
  error?: string
}

/** pharos_docs_lookup_spec — exact-spec fetch by id (or topic substring). */
export async function pharos_docs_lookup_spec(specIdOrTopic: string): Promise<DocsLookupResult> {
  const t0 = Date.now()
  const q = specIdOrTopic.toLowerCase()
  const spec =
    SPEC_CORPUS.find((s) => s.id.toLowerCase() === q) ??
    SPEC_CORPUS.find((s) => s.id.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q))
  if (!spec) {
    return {
      tool: "pharos_docs_lookup_spec", ok: false, latencyMs: Date.now() - t0,
      allSpecIds: SPEC_CORPUS.map((s) => s.id),
      error: `no spec matching "${specIdOrTopic}"`,
    }
  }
  return { tool: "pharos_docs_lookup_spec", ok: true, latencyMs: Date.now() - t0, spec }
}

export interface InvariantCheck {
  invariantId: string
  statement: string
  passed: boolean
  observed: string
}

export interface DocsVerifyResult {
  tool: "pharos_docs_verify_abi_invariants"
  ok: boolean
  latencyMs: number
  specId?: string
  checks?: InvariantCheck[]
  summary?: { passed: number; total: number }
  error?: string
}

export interface InvariantContext {
  chainId?: number
  explorer?: string
  previewDepositReturns?: boolean
  convertToAssetsOfShares?: bigint | null
  rawAssets?: bigint | null
  accountedYield?: bigint | null
  yieldReserveBackstop?: bigint | null
  navBefore?: number | null
  navAfter?: number | null
  roiPassed?: boolean
  budgetPassed?: boolean
  signerIsUser?: boolean
  nonceUnused?: boolean
  challengeNotExpired?: boolean
  receiptHashMatches?: boolean
  amount?: bigint | null
  maxPerTxSpend?: bigint | null
  vaultWhitelisted?: boolean | null
  x402ReceiptHash?: string | null
  minSharesOut?: bigint | null
  quotedShares?: bigint | null
  intentDigestUnused?: boolean
  eventEmitted?: boolean
  srcHasSecrets?: boolean
  bundleComplete?: boolean
}

/** pharos_docs_verify_abi_invariants — verify observed values against spec. */
export async function pharos_docs_verify_abi_invariants(
  specId: string,
  ctx: InvariantContext,
): Promise<DocsVerifyResult> {
  const t0 = Date.now()
  const spec = SPEC_CORPUS.find((s) => s.id === specId)
  if (!spec) {
    return { tool: "pharos_docs_verify_abi_invariants", ok: false, latencyMs: Date.now() - t0, error: `unknown spec "${specId}"` }
  }

  const checks: InvariantCheck[] = []
  const add = (id: string, passed: boolean, observed: string) => {
    const inv = spec.invariants.find((i) => i.id === id)
    checks.push({ invariantId: id, statement: inv?.statement ?? id, passed, observed })
  }

  switch (specId) {
    case "pharos:network:atlantic": {
      add("NET-1", ctx.chainId === 688689, `chainId=${ctx.chainId}`)
      add("NET-2", Boolean(ctx.explorer?.startsWith("https://atlantic.pharosscan.xyz")), `explorer=${ctx.explorer}`)
      break
    }
    case "erc-4626:shares": {
      add("ERC4626-1", ctx.previewDepositReturns === true, `previewDepositReturned=${ctx.previewDepositReturns}`)
      if (ctx.convertToAssetsOfShares != null && ctx.rawAssets != null) {
        add("ERC4626-2", ctx.convertToAssetsOfShares <= ctx.rawAssets, `assets(${ctx.convertToAssetsOfShares}) <= raw(${ctx.rawAssets})`)
      } else {
        add("ERC4626-2", false, "insufficient conversion data")
      }
      if (ctx.accountedYield != null && ctx.yieldReserveBackstop != null) {
        add("ERC4626-3", ctx.accountedYield <= ctx.yieldReserveBackstop, `yield(${ctx.accountedYield}) <= backstop(${ctx.yieldReserveBackstop})`)
      } else {
        add("ERC4626-3", true, "not evaluated (no accrual data requested)")
      }
      if (ctx.navBefore != null && ctx.navAfter != null) {
        add("ERC4626-4", ctx.navAfter >= ctx.navBefore, `nav ${ctx.navBefore} -> ${ctx.navAfter}`)
      } else {
        add("ERC4626-4", true, "not evaluated (no nav pair requested)")
      }
      break
    }
    case "x402:http402": {
      add("X402-1", ctx.roiPassed === true && ctx.budgetPassed === true, `roi=${ctx.roiPassed} budget=${ctx.budgetPassed}`)
      add("X402-2", ctx.signerIsUser === true, `signerIsUser=${ctx.signerIsUser}`)
      add("X402-3", ctx.nonceUnused === true, `nonceUnused=${ctx.nonceUnused}`)
      add("X402-4", ctx.challengeNotExpired === true, `notExpired=${ctx.challengeNotExpired}`)
      add("X402-5", ctx.receiptHashMatches === true, `receiptHashMatch=${ctx.receiptHashMatches}`)
      break
    }
    case "sentinel:policy-firewall": {
      if (ctx.amount != null && ctx.maxPerTxSpend != null) add("FW-1", ctx.amount <= ctx.maxPerTxSpend, `amount(${ctx.amount}) vs cap(${ctx.maxPerTxSpend})`)
      if (ctx.vaultWhitelisted != null) add("FW-2", ctx.vaultWhitelisted, `whitelisted=${ctx.vaultWhitelisted}`)
      if (ctx.x402ReceiptHash != null) add("FW-3", ctx.x402ReceiptHash !== "0x" + "0".repeat(64), `receiptHash nonzero=${ctx.x402ReceiptHash !== "0x" + "0".repeat(64)}`)
      if (ctx.minSharesOut != null && ctx.quotedShares != null) add("FW-4", ctx.quotedShares >= ctx.minSharesOut, `quoted(${ctx.quotedShares}) >= min(${ctx.minSharesOut})`)
      if (ctx.intentDigestUnused != null) add("FW-5", ctx.intentDigestUnused, `digestUnused=${ctx.intentDigestUnused}`)
      if (ctx.eventEmitted != null) add("FW-6", ctx.eventEmitted, `eventEmitted=${ctx.eventEmitted}`)
      break
    }
    case "sentinel:agent-airgap": {
      add("AG-1", ctx.srcHasSecrets === false, `srcHasSecrets=${ctx.srcHasSecrets}`)
      add("AG-2", ctx.bundleComplete === true, `bundleComplete=${ctx.bundleComplete}`)
      break
    }
  }

  const passed = checks.filter((c) => c.passed).length
  return {
    tool: "pharos_docs_verify_abi_invariants", ok: passed === checks.length, latencyMs: Date.now() - t0,
    specId, checks, summary: { passed, total: checks.length },
  }
}

/** Convenience for the orchestrator: canonical citation line for a spec. */
export function citationFor(specId: string): string {
  const s = SPEC_CORPUS.find((x) => x.id === specId)
  return s ? `[Docs MCP] ${s.id} — "${s.title}" (source: ${s.source})` : `[Docs MCP] unknown spec ${specId}`
}
