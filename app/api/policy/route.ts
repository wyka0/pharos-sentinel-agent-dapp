/**
 * GET /api/policy?user=0x… — on-chain Policy Firewall config for a user
 * (mirrors SentinelPolicyFirewall.effectivePolicy + whitelist state).
 */
import { NextRequest } from "next/server"
import { jsonResponse } from "@/lib/json"
import { contractsDeployed } from "@/lib/config"
import { pharos_get_policy_config } from "@/lib/mcp/chain-mcp"
import { DEFAULT_POLICY, ERROR_SELECTORS } from "@/lib/agent/policy"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const user = new URL(req.url).searchParams.get("user")
  if (!user || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
    return jsonResponse({ error: "user query param (0x… address) required" }, { status: 400 })
  }
  if (!contractsDeployed()) {
    return jsonResponse({ ok: false, deployed: false, defaults: DEFAULT_POLICY, errorSelectors: ERROR_SELECTORS })
  }
  const res = await pharos_get_policy_config(user as `0x${string}`)
  return jsonResponse({
    ok: res.ok,
    latencyMs: res.latencyMs,
    policy: res.data,
    defaults: DEFAULT_POLICY,
    errorSelectors: ERROR_SELECTORS,
    error: res.error,
  })
}
