/**
 * GET /api/portfolio?user=0x… — user sUSDC + vault share positions (Chain MCP).
 */
import { NextRequest } from "next/server"
import { jsonResponse } from "@/lib/json"
import { contractsDeployed } from "@/lib/config"
import { pharos_get_user_portfolio } from "@/lib/mcp/chain-mcp"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const user = new URL(req.url).searchParams.get("user")
  if (!user || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
    return jsonResponse({ error: "user query param (0x… address) required" }, { status: 400 })
  }
  if (!contractsDeployed()) {
    return jsonResponse({ ok: false, deployed: false })
  }
  const res = await pharos_get_user_portfolio(user as `0x${string}`)
  return jsonResponse({ ok: res.ok, latencyMs: res.latencyMs, blockPinned: res.blockPinned, data: res.data, error: res.error })
}
