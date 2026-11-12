# Pharos Sentinel — Architecture

> Agent-native RWA due-diligence, portfolio concierge & policy-guarded execution desk
> on **Pharos Atlantic Testnet (`chainId 688689`)**.

---

## 1. System Overview

```
                                    ┌──────────────────────────────────────────────┐
                                    │                BROWSER (user)                │
                                    │  Next.js UI — AETHER design system           │
                                    │  wagmi + injected wallet = THE signer        │
                                    └───────────────┬──────────────────────────────┘
                                                    │ fetch / signTypedData / writeContract
                                                    ▼
┌───────────────────────────── NEXT.JS SERVER (agent runtime, src/, ZERO KEYS) ─────────────────────────────┐
│                                                                                                           │
│   /api/agent ──► SentinelAgentOrchestrator (src/lib/agent/orchestrator.ts)                                │
│                     │                                                                                     │
│     ┌───────────────┼───────────────────────────────┬──────────────────────────────┐                      │
│     ▼               ▼                               ▼                              ▼                      │
│ [Tool 1]        [Tool 2]                        [Tool 3]                      [Tool 4]                      │
│ Chain MCP       Docs MCP                        x402 client                   SkillEngine                   │
│ chain-mcp.ts    docs-mcp.ts                     x402/client.ts                skills/                       │
│                 │                               │   402 → ROI → sign → 200     ├─ StatefulTrendGuardSkill    │
│                 │                               │   (signature delegated       └─ HorizonNetYieldRouterSkill │
│                 │                               │    to USER's wallet)              │                        │
│                 │                               ▼                                   │                        │
│                 │                    /api/x402/attestation                           │                        │
│                 │                    (402 challenge / 200 attestation)               │                        │
│                 ▼                                                                   ▼                        │
│        policy pre-flight mirror (agent/policy.ts) — fail-closed G1..G5                             │
│                     │                                                                                            │
│                     ▼                                                                                            │
│   Prepared Action Bundle {to, data, value:0, chainId:688689,                                                     │
│     policyCheckReport, x402ReceiptHash, agentIntentDigest}   OR   Blocked / PaymentRequired / Advisory           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        │  user signs bundle (approval + guarded call)                        ▲
        ▼                                                                     │ reads (pinned block)
┌────────────────────────────── PHAROS ATLANTIC TESTNET (688689) ─────────────┴───────────────────────────────┐
│  SentinelUSD (sUSDC, 6dp, faucet) · PharosTBillRwaVault · AtlanticSeniorCreditVault · HarborBufferLendingPool│
│  SentinelX402OracleRegistry (providers, fees, anchored attestations)                                          │
│  SentinelPolicyFirewall  ◄── THE non-custodial execution gate (5 atomic guards)                               │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Trust boundaries:** the agent runtime holds no key material (canary-scanned). The browser wallet is the only signer of fund movement. The firewall contract is the only fund mover, and only under 5 on-chain guards.

---

## 2. The 4 Pharos AI Tools (deep integration)

### Tool 1 — Pharos Chain MCP (`src/lib/mcp/chain-mcp.ts`)

MCP-style tool envelope `{tool, ok, chainId, blockPinned, latencyMs, data|error}`:

| Tool call | Reads (all pinned to one block) |
|---|---|
| `pharos_get_vault_states` | 3 vaults × {totalAssets, supply, NAV, base/effective APY, fees, KYA ratio, paused, breaker, utilization, audit hash} |
| `pharos_get_user_portfolio` | sUSDC balance + vault share positions |
| `pharos_get_policy_config` | effective on-chain policy + whitelist map + guarded-volume counters |
| `pharos_simulate_guarded_tx` | `previewGuardedAllocation` view — the on-chain guard verdict **before** any signing |

**Fault isolation:** every vault read is a separate task under `Promise.allSettled`; a paused/broken vault degrades to `{healthy:false, degraded:true, error}` and the desk keeps operating (Scenario 5 proves it live).

### Tool 2 — Pharos Developer Docs MCP (`src/lib/mcp/docs-mcp.ts`)

A spec corpus (`SPEC_CORPUS`) with machine-checkable invariants:

- `pharos:network:atlantic` — NET-1/2 (chainId 688689, PharosScan links)
- `erc-4626:shares` — ERC4626-1..4 (preview purity, no inflation, pre-funded yield, monotone NAV)
- `x402:http402` — X402-1..5 (ROI-before-pay, user-signed payer, nonce single-use, expiry honored, tamper-evident receipt)
- `sentinel:policy-firewall` — FW-1..6 (guard order, replay protection, event emission)
- `sentinel:agent-airgap` — AG-1/2

`pharos_docs_verify_abi_invariants(specId, observedCtx)` evaluates observed on-chain values against each invariant and returns per-check pass/fail — **every orchestrator decision cites the exact spec rules it verified** (see `citationFor`).

### Tool 3 — x402 Agent Micropayments (`src/lib/x402/*`, `app/api/x402/attestation/route.ts`)

Real protocol semantics (see §4 for the sequence diagram). Key files:

- `types.ts` — challenge / payment header / attestation / canonical bytes
- `client.ts` — the agent-side handshake: **ROI gate → budget gate → delegated signing → replay with idempotency key → client-side receipt-hash tamper check**
- `route.ts` — server: issues HTTP 402 with `X-PAYMENT-REQUIRED` (base64 JSON challenge), verifies the user's EIP-712 `TransferWithAuthorization` signature via `verifyTypedData` (recovering the payer), enforces expiry + **nonce single-use**, honors **idempotency-key replays**, and issues an HMAC-signed attestation (`collateralRatioBps: 10240`, `auditHash`) plus `receiptHash = keccak256(canonical bytes)`.
- The receipt hash is what gets anchored on-chain (`SentinelX402OracleRegistry.recordAttestation`) and bound into the firewall call — closing the loop between an off-chain paid API call and on-chain execution.

**Session budget:** `sessionSpent` vs `sessionBudgetCap` (0.5 sUSDC) persisted in the SkillEngine state file; every payment is ledgered.

### Tool 4 — Pharos SkillEngine (`src/lib/skills/*`)

Persistent memory `.data/sentinel-state.json` with **atomic writes** (serialize → tmp file → `fsync` → `rename`) and **deterministic observation IDs** (`sha256(vault|nav|source|bucketTs)` — same-second replays dedupe).

**Skill A — `StatefulTrendGuardSkill`** (`trend-guard.ts`): the ≥3-observation rule

```
window < 3 obs                      → INSUFFICIENT_DATA (no action)
one drop > 1% then full recovery    → SPIKE_REJECTED      (0 transactions)
≥3 consecutive drops > 1% each      → TREND_CONFIRMED     → REBALANCE_TO_TBILL
```

*Proven live (Scenario 4):* `100 → 93 → 100` ⇒ `SPIKE_REJECTED`, 0 txs; `100 → 98 → 95 → 92` ⇒ `TREND_CONFIRMED` ⇒ protective `executeGuardedRebalance(credit → tbill)` executed on-chain.

**Skill B — `HorizonNetYieldRouterSkill`** (`horizon-router.ts`): exact `bigint` math per venue

```
entryFee   = dx · entryFeeBps / 10_000
invested   = dx − entryFee
grossYield = invested · effectiveApyBps · T / (10_000 · 365)          (credit APY is utilization-diluted)
exitFee    = (invested + grossYield) · exitFeeBps / 10_000
x402Fee    = 25_000 micro-sUSDC when the venue requires a paid audit
gasCost    = gasUnits · gasPriceWei · susdcPerPhrs / 1e18            (live Atlantic gas, priced)
netReturn  = invested + grossYield − exitFee − x402Fee − gasCost − dx
netApyBps  = netReturn · 10_000 · 365 / (dx · T)
```

Filtering (fail-closed): paused venues, unwhitelisted targets, `dx > maxPerTxSpend`, and venues above the user's **risk ceiling** are excluded *with reasons*; the ranking proceeds over survivors only.

---

## 3. Non-Custodial Policy Firewall State Machine

```
            ┌────────────┐   policy violation / no venue
   intent ─►│  PRE-FLIGHT │──────────────────────────────►  BLOCKED (fundsAuthorized = 0)
            │  (mirror +  │
            │  simulate)  │
            └─────┬──────┘
                  │ guards pass
                  ▼
            ┌────────────┐  oracle feed required but unpaid /
            │ PAYMENT-   │  user declines signature
            │  REQUIRED  │──────────────────────────────►  x402 challenge forwarded to wallet
            └─────┬──────┘
                  │ user signs EIP-3009 payment + pipeline resumes
                  ▼
            ┌────────────┐
            │  PREPARED  │  bundle {to=firewall, data, value:0, chainId:688689,
            │   BUNDLE   │        policyCheckReport, x402ReceiptHash, agentIntentDigest}
            └─────┬──────┘
                  │ USER signs approval (exact amount) + guarded call (wagmi)
                  ▼
            ┌─────────────────────────── ON-CHAIN ───────────────────────────┐
            │ G1 paused?            → revert FirewallPaused                  │
            │ G2 amount > cap?      → revert ExceedsPolicySpendCap(cap)      │
            │ G3 !whitelisted?      → revert UnwhitelistedTargetVault(vault) │
            │ G4 receiptHash == 0?  → revert MissingX402AuditAttestation     │
            │   digest replay?      → revert ReplayProtectedIntentDigest     │
            │ G5 quoted < min?      → revert SlippageExceeded(min, quoted)   │
            │ all pass → transferFrom → vault.deposit(user)                  │
            │          → emit SentinelAllocationExecuted(user, vault,        │
            │              amount, sharesOut, x402ReceiptHash,               │
            │              agentIntentDigest, blockNumber)                   │
            └────────────────────────────────────────────────────────────────┘
```

On-chain defaults: `maxPerTxSpend = 5,000 sUSDC`, `maxSlippageBps = 30`, `requireWhitelistedVault = true`, `requireValidX402Attestation = true`, `emergencyPaused = false` — user-adjustable per wallet via `setPolicy` (self-sovereign limits).

## 4. x402 Sequence (real HTTP semantics)

```
Agent(x402 client)                        Sentinel API (/api/x402/attestation)        User Wallet
      │  GET ?vault=credit                        │                                       │
      │ ────────────────────────────────────────► │                                       │
      │ ◄── HTTP 402 ───────────────────────────  │                                       │
      │   X-PAYMENT-REQUIRED (b64 JSON):          │                                       │
      │   {x402Version:1, scheme:"exact",         │                                       │
      │    price:"25000" (0.025 sUSDC),           │                                       │
      │    recipient, nonce, chainId:688689,      │                                       │
      │    expiry, provider}                      │                                       │
      │                                           │                                       │
      │  ROI gate: expectedYieldDelta > fee   ✔   │                                       │
      │  budget gate: spent + fee ≤ cap       ✔   │                                       │
      │ ─────────────── signTypedData(EIP-712 TransferWithAuthorization) ────────────────► │
      │ ◄──────────────────────────────── signature (USER key, agent NEVER signs) ─────── │
      │                                           │                                       │
      │  GET ?vault=credit                        │                                       │
      │   X-PAYMENT {scheme, payload{from, sig,   │                                       │
      │    validAfter, validBefore, nonce},       │                                       │
      │    idempotencyKey}                        │                                       │
      │ ────────────────────────────────────────► │  verifyTypedData → payer = user ✔     │
      │                                           │  expiry ✔ · nonce unused ✔            │
      │ ◄── HTTP 200 ───────────────────────────  │  budget ledger update ✔               │
      │   {attestation{provider, vault,           │                                       │
      │     collateralRatioBps:10240, auditHash,  │                                       │
      │     feePaid, serverSignature(HMAC)},      │                                       │
      │    receiptHash = keccak256(canonical)}    │                                       │
      │                                           │                                       │
      │  client-side tamper check: recompute keccak(canonical) === receiptHash ✔           │
      │                                           │                                       │
      │  anchor on-chain: SentinelX402OracleRegistry.recordAttestation(providerId, vault, │
      │  receiptHash, idempotencyKey)  ← user-signed tx                                   │
      │  bind: firewall.executeGuardedAllocation(..., x402ReceiptHash, agentIntentDigest) │
```

## 5. Deployment Topology & Gas Engineering

- Single-file suite (`contracts/PharosSentinelSuite.sol`), solc **optimizer ON (200 runs)**, custom errors, `immutable` bindings, virtual-offset share math → bytecode 1.9–7.1 KB per contract; **entire deploy + wiring + 5-scenario verification ≈ 0.012 PHRS**.
- Deployment order: `SentinelUSD → 3 vaults → registry → firewall`, then whitelist ×3, faucet ×2, real yield-reserve funding ×3 (solvent APY), provider registration ×3.
- Every deployment artifact (addresses + tx hashes) is persisted to `.data/deployments.json` and synced into `.env.local` for the UI.

## 6. Fault Isolation Model

| Layer | Mechanism |
|---|---|
| RPC reads | `Promise.allSettled` per vault + shared `blockNumber` pin (consistent snapshot, isolated failures) |
| Vault outage | `paused` / `circuitBreakerTripped` flags flow into routing → venue excluded with a human-readable reason (Scenario 5) |
| Oracle outage | x402 client returns `rejected` with telemetry; ROI/budget gates fail closed; no paid call is repeated blindly |
| Agent logic errors | API routes return structured errors via the BigInt-safe JSON layer; the UI degrades per-panel |
| Replay attacks | `agentIntentDigest` single-use on-chain; x402 nonce single-use server-side; idempotency keys for safe retries |
