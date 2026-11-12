/**
 * GET /api/vaults — live vault states (Chain MCP) + static catalog + the
 * desk's horizon reference: the top horizon-adjusted net APY the
 * HorizonNetYieldRouterSkill produces for the 2,500 sUSDC / 30d reference
 * ticket (same exact router the Copilot executes).
 */
import { contractAddresses, contractsDeployed, vaultCatalog, POLICY_DEFAULTS } from "@/lib/config"
import { pharos_get_vault_states } from "@/lib/mcp/chain-mcp"
import { routeHorizon, defaultGasContext, type VaultMath } from "@/lib/skills/horizon-router"
import { jsonResponse } from "@/lib/json"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** reference ticket for the Pulse "Horizon-Adj Net APY" KPI */
const REFERENCE = { depositMicro: 2_500_000_000n, horizonDays: 30 }

export async function GET() {
  const catalog = vaultCatalog()
  const addresses = contractAddresses()
  if (!contractsDeployed()) {
    return jsonResponse({
      ok: false,
      deployed: false,
      hint: "run `npm run deploy` to deploy PharosSentinelSuite to Pharos Atlantic Testnet",
      catalog,
      addresses,
    })
  }
  // one retry to ride out transient Atlantic RPC hiccups (fail-isolated reads
  // below already degrade per-vault, but a failed block-pin shouldn't blank the desk)
  let states = await pharos_get_vault_states()
  if (!states.ok) {
    await new Promise((r) => setTimeout(r, 800))
    states = await pharos_get_vault_states()
  }

  // horizon reference: rank the live (normalized) venues with the SAME router
  // the Copilot runs — top-of-book view (risk ceiling wide open, deployment whitelist)
  let horizonReference: { depositSusdc: string; horizonDays: number; topNetApyBps: string | null; topNetSusdc: string | null; winnerId: string | null } | null = null
  const liveVaults = states.data?.vaults ?? []
  if (states.ok && liveVaults.length > 0) {
    const venues: VaultMath[] = liveVaults.map((s) => ({
      id: s.id,
      label: s.label,
      effectiveApyBps: s.effectiveApyBps ?? 0n,
      entryFeeBps: s.entryFeeBps ?? 0n,
      exitFeeBps: s.exitFeeBps ?? 0n,
      riskScore: catalog.find((c) => c.id === s.id)?.riskScore ?? 100,
      requiresX402Audit: s.x402AttestationRequired,
      paused: s.paused ?? false,
      whitelisted: true, // deployment whitelist covers all 3 catalog vaults (see SentinelPolicyFirewall)
    }))
    const routed = routeHorizon(
      venues,
      REFERENCE.depositMicro,
      REFERENCE.horizonDays,
      {
        maxPerTxSpend: POLICY_DEFAULTS.maxPerTxSpend,
        maxSlippageBps: BigInt(POLICY_DEFAULTS.maxSlippageBps),
        requireWhitelistedVault: POLICY_DEFAULTS.requireWhitelistedVault,
        requireValidX402Attestation: POLICY_DEFAULTS.requireValidX402Attestation,
        riskCeiling: 100, // top-of-book reference: no user ceiling applied
      },
      defaultGasContext(),
    )
    horizonReference = {
      depositSusdc: "2500",
      horizonDays: REFERENCE.horizonDays,
      topNetApyBps: routed.winner?.breakdown.netApyBps.toString() ?? null,
      // absolute 30d net yield of the reference ticket (micro-sUSDC) — used by
      // the Pulse "Attestation ROI" highlight (net yield ÷ 0.025 sUSDC audit fee)
      topNetSusdc: routed.winner?.breakdown.netReturn.toString() ?? null,
      winnerId: routed.winner?.id ?? null,
    }
  }

  return jsonResponse({
    ok: states.ok,
    deployed: true,
    chainId: states.chainId,
    blockPinned: states.data?.blockNumber ?? null,
    latencyMs: states.latencyMs,
    healthyVaults: states.data?.healthyVaults ?? [],
    isolatedVaults: states.data?.isolatedVaults ?? [],
    vaults: states.data?.vaults ?? [],
    horizonReference,
    catalog,
    addresses,
    error: states.error,
  })
}
