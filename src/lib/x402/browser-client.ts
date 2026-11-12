"use client"

/**
 * src/lib/x402/browser-client.ts — browser-side x402 handshake.
 * The USER's wallet signs the EIP-3009 authorization (wagmi signTypedData);
 * no server or agent key is ever involved. Real HTTP 402 -> 200 flow.
 */
import { keccak256, toHex } from "viem"
import type { X402Attestation, X402Challenge } from "./types"

export interface BrowserX402Result {
  status: "ok" | "rejected"
  reason?: string
  challenge?: X402Challenge
  attestation?: X402Attestation
  receiptHash?: string
  idempotencyKey?: string
  telemetry: { attempts: number; challengeReceived: boolean; latencyMs: number }
}

export function parseChallengeHeader(headerValue: string | null): X402Challenge | null {
  if (!headerValue) return null
  try {
    const text = headerValue.trim().startsWith("{") ? headerValue : atob(headerValue)
    const c = JSON.parse(text)
    return c && c.chainId && c.nonce ? (c as X402Challenge) : null
  } catch {
    return null
  }
}

export function hashCanonicalBrowser(bytes: string): string {
  return keccak256(toHex(bytes))
}

export function canonicalAttestationBrowser(a: X402Attestation): string {
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
