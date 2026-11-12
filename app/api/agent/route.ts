/**
 * POST /api/agent — the SentinelAgentOrchestrator endpoint.
 * Body: { prompt, userAddress, overrides?, x402SignedPayment? }
 * Returns a non-custodial PreparedActionBundle / PaymentRequired /
 * BlockedByPolicy / Advisory + full 4-tool pipeline telemetry.
 */
import { NextRequest } from "next/server"
import { jsonResponse } from "@/lib/json"
import { runSentinelPipeline, type OrchestratorOptions } from "@/lib/agent/orchestrator"
import type { Address } from "viem"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

interface AgentRequest {
  prompt: string
  userAddress: string
  overrides?: Partial<OrchestratorOptions["overrides"]>
  x402SignedPayment?: {
    vaultKey: string
    idempotencyKey: string
    receiptHash: string
    attestation?: unknown
  }
  trendObservations?: Array<{ vaultId: string; navMicro: string }>
  /** failover DRILL (labeled): vault ids treated as isolated for this run */
  outageDrill?: string[]
  skipX402?: boolean
  /** reviewer-session mode: bind the cached/last verified x402 receipt (no live payment) */
  useSessionReceipt?: boolean
}

export async function POST(req: NextRequest) {
  let body: AgentRequest
  try {
    body = (await req.json()) as AgentRequest
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, { status: 400 })
  }
  if (!body.prompt || typeof body.prompt !== "string") {
    return jsonResponse({ error: "prompt (string) required" }, { status: 400 })
  }
  if (!body.userAddress || !/^0x[0-9a-fA-F]{40}$/.test(body.userAddress)) {
    return jsonResponse({ error: "userAddress (0x… 20-byte) required" }, { status: 400 })
  }

  // coerce JSON-safe string amounts back to bigint for the orchestrator
  const overrides = body.overrides
    ? {
        ...body.overrides,
        amount:
          body.overrides.amount != null && /^\d+$/.test(String(body.overrides.amount))
            ? BigInt(String(body.overrides.amount))
            : body.overrides.amount,
      }
    : undefined

  const outcome = await runSentinelPipeline({
    user: body.userAddress as Address,
    prompt: body.prompt,
    baseUrl: new URL(req.url).origin,
    overrides,
    x402SignedPayment: body.x402SignedPayment
      ? {
          vaultKey: body.x402SignedPayment.vaultKey as never,
          headerJson: "",
          idempotencyKey: body.x402SignedPayment.idempotencyKey,
          receiptHash: body.x402SignedPayment.receiptHash as `0x${string}`,
          attestation: body.x402SignedPayment.attestation,
        }
      : undefined,
    trendObservations: body.trendObservations?.map((t) => ({ vaultId: t.vaultId, navMicro: BigInt(t.navMicro) })),
    outageDrill: body.outageDrill,
    skipX402: body.skipX402,
    useSessionReceipt: body.useSessionReceipt,
    // live HTTP 402 handshake only when the flow wants a REAL payment
    // (session-receipt and skip modes never move funds)
    fetchImpl: body.skipX402 || body.useSessionReceipt ? undefined : fetch,
  })

  return jsonResponse(outcome)
}
