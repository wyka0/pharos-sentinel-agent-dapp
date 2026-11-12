/**
 * src/lib/x402/types.ts — x402 HTTP 402 micropayment protocol types
 * (Sentinel flavor of x402.org with EIP-3009 TransferWithAuthorization).
 */

export interface X402Challenge {
  x402Version: 1
  scheme: "exact"
  /** price in sUSDC base units (6 decimals) as string for JSON safety */
  price: string
  asset: `0x${string}`
  recipient: `0x${string}`
  nonce: `0x${string}`
  chainId: 688689
  /** unix seconds */
  expiry: number
  resource: string
  description: string
  provider: string
}

export interface X402PaymentHeader {
  scheme: "exact"
  payload: {
    from: `0x${string}`
    /** EIP-3009 TransferWithAuthorization EIP-712 signature (user wallet) */
    signature: `0x${string}`
    validAfter: string
    validBefore: string
    nonce: `0x${string}`
  }
  idempotencyKey: string
  challengeNonce: `0x${string}`
}

export interface X402Attestation {
  provider: string
  vault: string
  vaultLabel: string
  collateralRatioBps: number
  navPerShare: string
  auditHash: `0x${string}`
  attestedAt: number
  chainId: 688689
  feePaid: string
  /** HMAC-SHA256 server signature over the canonical attestation bytes */
  serverSignature: string
}

export interface X402Receipt {
  receiptHash: `0x${string}`
  attestation: X402Attestation
  idempotencyKey: string
  replayed: boolean
}

/** The canonical string whose keccak256 becomes the on-chain x402ReceiptHash. */
export function canonicalAttestationBytes(a: X402Attestation): string {
  return [
    "SENTINEL-X402-ATTESTATION-V1",
    a.provider,
    a.vault,
    a.vaultLabel,
    String(a.collateralRatioBps),
    a.navPerShare,
    a.auditHash,
    String(a.attestedAt),
    String(a.chainId),
    a.feePaid,
    a.serverSignature,
  ].join("|")
}
