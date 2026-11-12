# Pharos Sentinel — Autonomous RWA Due-Diligence, Portfolio Concierge & Policy-Guarded Execution Desk

**Agent-native dApp on Pharos Atlantic Testnet (chainId `688689`)** — an autonomous agent that performs real RWA due diligence, routes capital across three on-chain vaults, pays for its own risk oracles over x402 micropayments, and can *never* move user funds: every action is a **non-custodial Prepared Action Bundle** that the on-chain **SentinelPolicyFirewall** re-verifies before the user's wallet signs.

---

## 🎯 Who It's For & What Real Problem It Solves

**Who it's for:** institutions, treasuries and sophisticated individual allocators who want tokenized-RWA yield (T-Bills, senior private credit, liquidity buffers) but cannot give an AI agent direct custody of funds — plus Pharos reviewers evaluating how far agent integration can go *without* compromising safety.

**The real problem:** autonomous DeFi agents today face an impossible choice —

1. **Custodial agents** (keys in a server) can act fast but are unacceptable risk.
2. **Pure advisory bots** never touch chains, so they can't execute, can't pay for the data they need, and can't prove what they did.

**Pharos Sentinel resolves the dilemma with a 4-layer architecture:** the agent does ALL the cognitive work (discovery → spec verification → paid audits → routing → protection), but *every* fund-moving step is compiled into a signed-by-the-user bundle that an **on-chain firewall** independently re-checks with 5 atomic guards. The agent is powerful *because* it is non-custodial, not despite it.

---

## 🚀 Quick Start (3 commands)

```bash
npm install
npm run test            # 302 passing Vitest tests
npm run dev             # UI at http://localhost:3000 (contracts already live)
```

The full suite is **already deployed and verified** on Pharos Atlantic Testnet (see receipts below). To redeploy from scratch: `npm run compile && npm run deploy` (needs `TEST_USER_PRIVATE_KEY` in `.env.local`), then `npm run verify`.

---

## 🧾 Live On-Chain Receipts (PharosScan — click to verify)

| Artifact | Transaction / Address |
|---|---|
| SentinelUSD (sUSDC) | [`0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b`](https://atlantic.pharosscan.xyz/address/0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b) |
| Vault A — PharosTBillRwaVault (ERC-4626) | [`0x001ef1ebebe4167dc0645e33875e9235c7dfaf78`](https://atlantic.pharosscan.xyz/address/0x001ef1ebebe4167dc0645e33875e9235c7dfaf78) |
| Vault B — AtlanticSeniorCreditVault | [`0x28080450b7be3963f55296ea9f2b45ad9af1b720`](https://atlantic.pharosscan.xyz/address/0x28080450b7be3963f55296ea9f2b45ad9af1b720) |
| Vault C — HarborBufferLendingPool | [`0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77`](https://atlantic.pharosscan.xyz/address/0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77) |
| SentinelX402OracleRegistry | [`0x303ab8dbc96b7a5ce175b0096ebcea7656fc189f`](https://atlantic.pharosscan.xyz/address/0x303ab8dbc96b7a5ce175b0096ebcea7656fc189f) |
| **SentinelPolicyFirewall** | [`0x4bf82bc533befdafa0a0d2154842394b37a40ea1`](https://atlantic.pharosscan.xyz/address/0x4bf82bc533befdafa0a0d2154842394b37a40ea1) |
| ✅ S2 — Guarded allocation EXECUTED (`SentinelAllocationExecuted`) | [`0x55f438120b424bd481eb606be614d4346e8a851c57d290dcb740a9856ff5ebda`](https://atlantic.pharosscan.xyz/tx/0x55f438120b424bd481eb606be614d4346e8a851c57d290dcb740a9856ff5ebda) |
| ✅ S4 — Protective rebalance into T-Bill vault (`SentinelRebalanceExecuted`) | [`0x835fcc7e22eb37fd27d1cd79e5f301f15131ea68a2984d0c74e423e070c5bc81`](https://atlantic.pharosscan.xyz/tx/0x835fcc7e22eb37fd27d1cd79e5f301f15131ea68a2984d0c74e423e070c5bc81) |
| ✅ S1 — x402 attestation anchored on-chain | [`0x…`](evidence/sentinel-evidence.json) (full receipt table in [SUBMISSION_EVIDENCE.md](SUBMISSION_EVIDENCE.md)) |

Full 5-scenario transcripts: **[SUBMISSION_EVIDENCE.md](SUBMISSION_EVIDENCE.md)** · machine-readable: `evidence/sentinel-evidence.json`.

**On-chain realism seed** (`npm run seed`): keeps all 3 vaults at healthy institutional baseline liquidity (T-Bill 6,000 · Senior Credit 8,000 · Harbor 5,000 sUSDC), NAV/share ~1.000x, credit utilization 42% — e.g. [`0xf65701…0b6a27`](https://atlantic.pharosscan.xyz/tx/0xf657018fb570cbe7625f8d948fce8928a839453c03e031588a228254ec0b6a27) (T-Bill deposit), [`0x522550…9a661`](https://atlantic.pharosscan.xyz/tx/0x522550d13f963d428acb7d20bbcedfbef37ab84bdb6d9a395482ba9f0ec9a661) (utilization normalization). Full tx list: `evidence/sentinel-evidence.json → .seed`.

---

## 🤖 The 4 Pharos AI Tools — Integration Matrix (all four are load-bearing)

| # | Tool | Module | What it actually does (not a mock) | Where you see it |
|---|---|---|---|---|
| 1 | **Chain MCP** | `src/lib/mcp/chain-mcp.ts` | `pharos_get_vault_states`, `pharos_get_user_portfolio`, `pharos_get_policy_config`, `pharos_simulate_guarded_tx` — **same-block-pinned** live reads against `688689` with `Promise.allSettled` per-vault fault isolation | `/pipeline`, every Copilot run |
| 2 | **Docs MCP** | `src/lib/mcp/docs-mcp.ts` | `pharos_docs_lookup_spec` + `pharos_docs_verify_abi_invariants` — agent decisions **cite exact spec rules** (Atlantic `688689` network spec, ERC-4626 invariants, EIP-3009/x402, firewall invariants) and every check is re-verified at runtime | Copilot pipeline step 2, `/engine` |
| 3 | **x402 Micropayments** | `src/lib/x402/*` + `/api/x402/attestation` | **Real HTTP `402` → ROI gate → EIP-3009 user-signed `X-PAYMENT` → `200` attestation** with idempotency keys, nonce-replay protection, HMAC-signed attestations, tamper-evident `receiptHash` bound into the firewall call | Copilot (wallet signs), `evidence/` |
| 4 | **SkillEngine** | `src/lib/skills/*` | Two production skills with **persistent atomic disk memory** (`.data/sentinel-state.json`, tmp→fsync→rename): `StatefulTrendGuardSkill` (≥3-observation rule) + `HorizonNetYieldRouterSkill` (exact bigint net-yield math) | `/engine`, Copilot, Scenario 4 |

The orchestrator (`src/lib/agent/orchestrator.ts`) runs the same verifiable pipeline on **every** request: `Chain MCP → Docs MCP → x402 → SkillEngine → Policy pre-flight → Prepared Action Bundle | PaymentRequired | Blocked | Advisory`.

---

## 🛡️ Safety & Policy Firewall (Requirement 04)

```
 user intent
     │
     ▼
┌───────────────────────────── AGENT (src/, ZERO KEYS) ─────────────────────────────┐
│ Chain MCP → Docs MCP → x402 (ROI+budget gate) → SkillEngine                        │
│        └────────────► Policy pre-flight mirror (G1..G5, fail-closed) ◄───────┐     │
└─────────────────────────────────────────────────────────────────────────────│─────┘
                                                                              │ fail
     Prepared Action Bundle {to, data, value:0, chainId:688689,               ▼
       policyCheckReport, x402ReceiptHash, agentIntentDigest}      BLOCKED (0 funds)
     │
     ▼  USER's wallet signs (wagmi) — agent CANNOT sign
┌──────────────────── ON-CHAIN SentinelPolicyFirewall ──────────────────────────────┐
│ G1 kill-switch (FirewallPaused)                                                   │
│ G2 per-tx spend cap 5,000 sUSDC (ExceedsPolicySpendCap)                           │
│ G3 vault whitelist (UnwhitelistedTargetVault)                                     │
│ G4 x402 attestation binding (MissingX402AuditAttestation) + intent-digest replay  │
│ G5 slippage bound 30 bps (SlippageExceeded)                                       │
│ all pass → deposit → event SentinelAllocationExecuted(...)                        │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **Zero private keys in `src/`** — enforced by `npm run audit:secrets` (canary scanner + git hygiene checks).
- **On-chain is the arbiter**: the firewall re-runs all guards at execution time; the agent's mirror is advisory-only.
- **Replay-proof**: `agentIntentDigest` is single-use on-chain (`usedAgentIntentDigest`).
- **Proven live**: Scenario 3 broadcast a 15,000 sUSDC allocation → reverted `ExceedsPolicySpendCap` → **0 funds moved** (balance verified unchanged).

## 🧪 Test Suite (250+ required — we ship 302)

| Suite | Coverage |
|---|---|
| `tests/unit/policy.test.ts` | Full guard matrix incl. cap boundaries, whitelist+pause interplay, guard ordering, intent-digest determinism |
| `tests/unit/x402.test.ts` | 402→200 handshake, ROI gate, budget cap, signer delegation, tamper detection, fault handling |
| `tests/unit/trend-guard.test.ts` | `100→93→100 ⇒ SPIKE_REJECTED (0 txs)`, `100→98→95→92 ⇒ TREND_CONFIRMED + REBALANCE_TO_TBILL`, dedup, atomic persistence |
| `tests/unit/horizon-router.test.ts` | Exact bigint yield math, fee/x402/gas breakdowns, risk & policy filters, fail-closed routing |
| `tests/unit/docs-mcp.test.ts` | Spec citations + every invariant branch (NET/ERC4626/X402/FW/AG) |
| `tests/unit/chain-mcp.test.ts` | MCP envelope contract, graceful degradation, guard reason resolution |
| `tests/unit/json.test.ts` | BigInt-safe serialization round-trips |
| `tests/unit/airgap.test.ts` | Canary: no signer material in `src/`, bundle completeness |
| `tests/integration/api-routes.test.ts` | All 7 routes incl. **real EIP-712 signature verification**, nonce replay, idempotent replays |

Run: `npm test` · type-check: `npx tsc --noEmit` (clean).

---

## 🖥️ UI (preserved AETHER design system)

The exact visual language of the original template (lime `#99CC00` accent, glass panels, 0-radius, sidebar + KPI glance cards + multi-series Recharts) is preserved and re-mapped:

| Template view | Sentinel view |
|---|---|
| Campaigns table & cards | **Active Agent Mandates** (3 on-chain vaults with live APY/fees/KYA) |
| Budget/Spend/ROI/Conversion KPI cards | **Portfolio TVL · Horizon-Adj Net APY · x402 Session Spend & Attestation ROI · Policy Guards 4/4** |
| Campaign Builder | **Agent Intent Copilot** (NL prompt + deposit/horizon/risk sliders) |
| Audience/Channels/Funnel | **Live 4-Tool Execution Pipeline** (latency, block height, 402 receipts, skill commitments) |
| Performance trend charts | **Stateful Trend Memory & Net-Yield Curve** (spike-rejection demo buttons) |
| Approvals/Settings/Billing drawer | **On-Chain Policy Firewall & Non-Custodial Signing Drawer** (raw calldata + receipts) |

Pages: `/` Pulse · `/copilot` · `/engine` · `/vaults` · `/pipeline` · `/firewall` · `/settings`.

---

## ⚠️ Clearly Stated Limits & Architectural Boundaries

1. **Testnet simulation, clearly labeled.** sUSDC is a faucet token; vault APYs are protocol parameters with **pre-funded, real yield reserves** (never unbacked accrual) — but the underlying T-Bill/credit portfolios are simulated. No bridge to real RWA servicing data ships here.
2. **The x402 recipient is the firewall treasury** and payment verification is signature-only on this testnet (no EIP-3009 `transferWithAuthorization` execution of sUSDC — the signed authorization is verified + ledgered, not settled by a token contract, because the demo `sUSDC` implements standard `approve/transferFrom`).
3. **One signer per bundle.** The Prepared Action Bundle model requires the user to sign the approval and the guarded call separately (2 wallet popups). Meta-transactions/ERC-4337 batching are deliberately out of scope to keep custody boundaries explicit.
4. **Whitelist changes are owner-only** on this deployment (deployer = manager). A production desk would put that behind a timelock/governance module.
5. **Trend guard memory is local** (`.data/sentinel-state.json`). It is deterministic and atomic but not decentralized; a production deployment would anchor verdict hashes on-chain (the `agentIntentDigest` pattern already supports it).
6. **Gas modeling** uses fixed testnet assumptions (2 gwei, 350k units, 2 sUSDC/PHRS) exposed as inputs, not oracles.
7. **The agent's NLP parsing** is deterministic heuristics (regex + keyword intents), not an LLM — the pipeline is model-agnostic and the same orchestrator can sit in front of any LLM planner; all *capabilities* demonstrated here are tool-side.
8. **Rate/abuse limits** rely on the per-session x402 budget cap and faucet cooldown; a production deployment would add per-IP quotas.

---

## 📚 Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — system diagrams, firewall state machine, x402 sequence, SkillEngine math
- [SUBMISSION_EVIDENCE.md](SUBMISSION_EVIDENCE.md) — full live verification transcripts with PharosScan links
