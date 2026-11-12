/**
 * src/lib/abi.ts — minimal human-readable ABI fragments for read/encode use
 * inside the Sentinel agent runtime. Server-safe (no signer material).
 */
import type { Abi } from "viem"

export const sentinelUsdAbi = [
  { type: "function", name: "faucet", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const satisfies Abi

export const vaultAbi = [
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "totalAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "baseApyBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "effectiveApyBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "entryFeeBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "exitFeeBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "paused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "kyaCollateralRatioBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "pure" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "convertToAssets", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "convertToShares", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "previewDeposit", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "previewRedeem", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "utilizationBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "latestAuditHash", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "circuitBreakerTripped", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "healthCheck", inputs: [], outputs: [{ type: "bool" }, { type: "bool" }, { type: "bool" }], stateMutability: "view" },
] as const satisfies Abi

export const policyFirewallAbi = [
  { type: "function", name: "effectivePolicy", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "tuple", components: [
      { name: "maxPerTxSpend", type: "uint256" },
      { name: "maxSlippageBps", type: "uint256" },
      { name: "requireWhitelistedVault", type: "bool" },
      { name: "requireValidX402Attestation", type: "bool" },
      { name: "emergencyPaused", type: "bool" },
    ] }], stateMutability: "view" },
  { type: "function", name: "previewGuardedAllocation", inputs: [
      { name: "user", type: "address" }, { name: "vault", type: "address" }, { name: "amount", type: "uint256" },
      { name: "minSharesOut", type: "uint256" }, { name: "x402ReceiptHash", type: "bytes32" },
    ], outputs: [{ type: "bool" }, { type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "executeGuardedAllocation", inputs: [
      { name: "vault", type: "address" }, { name: "amount", type: "uint256" }, { name: "minSharesOut", type: "uint256" },
      { name: "x402ReceiptHash", type: "bytes32" }, { name: "agentIntentDigest", type: "bytes32" },
    ], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "executeGuardedRebalance", inputs: [
      { name: "fromVault", type: "address" }, { name: "toVault", type: "address" }, { name: "sharesIn", type: "uint256" },
      { name: "minAssetsOut", type: "uint256" }, { name: "x402ReceiptHash", type: "bytes32" }, { name: "agentIntentDigest", type: "bytes32" },
    ], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "setPolicy", inputs: [
      { name: "maxPerTxSpend", type: "uint256" }, { name: "maxSlippageBps", type: "uint256" },
      { name: "requireWhitelistedVault", type: "bool" }, { name: "requireValidX402Attestation", type: "bool" },
    ], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setEmergencyPause", inputs: [{ name: "paused", type: "bool" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "whitelistedVault", inputs: [{ name: "vault", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "totalGuardedVolume", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalBlockedAttempts", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "usedAgentIntentDigest", inputs: [{ name: "d", type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  {
    type: "event", name: "SentinelAllocationExecuted",
    inputs: [
      { name: "user", type: "address", indexed: true }, { name: "vault", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }, { name: "sharesOut", type: "uint256", indexed: false },
      { name: "x402ReceiptHash", type: "bytes32", indexed: false }, { name: "agentIntentDigest", type: "bytes32", indexed: false },
      { name: "blockNumber", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "SentinelRebalanceExecuted",
    inputs: [
      { name: "user", type: "address", indexed: true }, { name: "fromVault", type: "address", indexed: true },
      { name: "toVault", type: "address", indexed: true }, { name: "sharesIn", type: "uint256", indexed: false },
      { name: "assetsOut", type: "uint256", indexed: false }, { name: "x402ReceiptHash", type: "bytes32", indexed: false },
      { name: "agentIntentDigest", type: "bytes32", indexed: false },
    ],
  },
  { type: "event", name: "GuardRejected", inputs: [
      { name: "user", type: "address", indexed: true }, { name: "vault", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }, { name: "reason", type: "bytes32", indexed: false },
    ] },
] as const satisfies Abi

export const oracleRegistryAbi = [
  { type: "function", name: "providerCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "attestationCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "providerInfo", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "tuple", components: [
      { name: "name", type: "string" }, { name: "endpoint", type: "string" }, { name: "feePerCallUSDC6", type: "uint256" },
      { name: "active", type: "bool" }, { name: "totalCalls", type: "uint256" }, { name: "totalFeesCollected", type: "uint256" },
    ] }], stateMutability: "view" },
  { type: "function", name: "latestAttestationForVault", inputs: [{ name: "vault", type: "address" }], outputs: [
      { type: "tuple", components: [
        { name: "providerId", type: "uint64" }, { name: "vault", type: "address" }, { name: "attestationHash", type: "bytes32" },
        { name: "feePaidUSDC6", type: "uint256" }, { name: "payer", type: "address" }, { name: "at", type: "uint64" },
        { name: "paymentReference", type: "string" },
      ] },
      { type: "tuple", components: [
        { name: "name", type: "string" }, { name: "endpoint", type: "string" }, { name: "feePerCallUSDC6", type: "uint256" },
        { name: "active", type: "bool" }, { name: "totalCalls", type: "uint256" }, { name: "totalFeesCollected", type: "uint256" },
      ] },
    ], stateMutability: "view" },
  { type: "function", name: "recordAttestation", inputs: [
      { name: "providerId", type: "uint256" }, { name: "vault", type: "address" }, { name: "attestationHash", type: "bytes32" },
      { name: "paymentReference", type: "string" },
    ], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
] as const satisfies Abi
