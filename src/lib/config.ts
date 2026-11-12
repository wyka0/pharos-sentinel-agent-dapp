/**
 * src/lib/config.ts — Sentinel runtime configuration.
 *
 * SECURITY ARCHITECTURE (Requirement 04):
 *   This file intentionally contains ONLY non-secret, non-custodial config.
 *   No private keys, no mnemonics, no signer material is ever read in src/.
 *   The test payer key lives exclusively in scripts/ (airgapped from src/).
 */

export const CHAIN_ID = 688689
export const CHAIN_NAME = "Pharos Atlantic Testnet"
export const EXPLORER_URL = process.env.PHAROS_EXPLORER_URL || "https://atlantic.pharosscan.xyz"
export const RPC_URL = process.env.PHAROS_RPC_URL || "https://atlantic.dplabs-internal.com"

/** Vault registry — populated by `npm run deploy` into .env.local. */
export function contractAddresses() {
  return {
    susdc: envAddr("PHAROS_SENTINEL_SUSD_ADDRESS"),
    vaultTBill: envAddr("PHAROS_SENTINEL_VAULT_TBILL_ADDRESS"),
    vaultCredit: envAddr("PHAROS_SENTINEL_VAULT_CREDIT_ADDRESS"),
    vaultHarbor: envAddr("PHAROS_SENTINEL_VAULT_HARBOR_ADDRESS"),
    oracleRegistry: envAddr("PHAROS_SENTINEL_ORACLE_REGISTRY_ADDRESS"),
    policyFirewall: envAddr("PHAROS_SENTINEL_POLICY_FIREWALL_ADDRESS"),
  }
}

export type SentinelAddresses = ReturnType<typeof contractAddresses>

function envAddr(key: string): `0x${string}` {
  const v = process.env[key]
  if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) return v.toLowerCase() as `0x${string}`
  return "0x0000000000000000000000000000000000000000" as `0x${string}`
}

export function contractsDeployed(): boolean {
  const a = contractAddresses()
  return a.susdc !== "0x0000000000000000000000000000000000000000"
}

/* --------------------------- Static desk metadata -------------------------- */

export type VaultId = "tbill" | "credit" | "harbor"

export interface VaultMeta {
  id: VaultId
  label: string
  short: string
  address: `0x${string}`
  kind: "RWA" | "RWA-Private-Credit" | "DeFi"
  baseApyBps: number
  entryFeeBps: number
  exitFeeBps: number
  /** illustrative risk score 0-100 (KYA + audit + liquidity profile) */
  riskScore: number
  accent: string
  description: string
}

export function vaultCatalog(): VaultMeta[] {
  const a = contractAddresses()
  return [
    {
      id: "tbill",
      label: "Pharos T-Bill RWA ERC-4626 Vault",
      short: "T-Bill RWA",
      address: a.vaultTBill,
      kind: "RWA",
      baseApyBps: 815,
      entryFeeBps: 0,
      exitFeeBps: 0,
      riskScore: 12,
      accent: "chart-1",
      description: "Tokenized short-duration US T-Bills. KYA-compliant, 102.8% reserve backing, deep liquidity, zero entry/exit fees.",
    },
    {
      id: "credit",
      label: "Atlantic Senior Private Credit Pool",
      short: "Senior Credit",
      address: a.vaultCredit,
      kind: "RWA-Private-Credit",
      baseApyBps: 1045,
      entryFeeBps: 12,
      exitFeeBps: 5,
      riskScore: 58,
      accent: "chart-2",
      description: "Senior-secured private credit. Utilization-diluted APY, 12/5 bps fees, x402 reserve-audit attestation REQUIRED before allocation.",
    },
    {
      id: "harbor",
      label: "Harbor Instant-Liquidity Buffer Vault",
      short: "Harbor Buffer",
      address: a.vaultHarbor,
      kind: "DeFi",
      baseApyBps: 740,
      entryFeeBps: 0,
      exitFeeBps: 5,
      riskScore: 34,
      accent: "chart-4",
      description: "Instant-withdrawal DeFi lending buffer. Circuit-breaker isolated — designed as the desk's fault-isolation canary.",
    },
  ]
}

/* ------------------------------ x402 constants ----------------------------- */

export const X402_PRICE_USDC6 = 25_000n // 0.025 sUSDC per oracle call
export const X402_SESSION_BUDGET_CAP_USDC6 = 500_000n // 0.50 sUSDC per session

/* --------------------------- Policy firewall defaults ---------------------- */

export const POLICY_DEFAULTS = {
  maxPerTxSpend: 5_000_000_000n, // 5,000 sUSDC (6 decimals)
  maxSlippageBps: 30,
  requireWhitelistedVault: true,
  requireValidX402Attestation: true,
  emergencyPaused: false,
}

export const pharosScanAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`
export const pharosScanTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`
