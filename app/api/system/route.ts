/**
 * GET /api/system — deployment + network + SkillEngine info for the UI header.
 * Also exposes GLOBAL on-chain state that must render without a connected
 * wallet: firewall guarded-volume counters and the vault whitelist map.
 */
import { jsonResponse } from "@/lib/json"
import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, RPC_URL, contractAddresses, contractsDeployed, POLICY_DEFAULTS, vaultCatalog } from "@/lib/config"
import { loadState } from "@/lib/skills/state"
import { SKILL_REGISTRY } from "@/lib/skills"
import { chainClient } from "@/lib/mcp/chain-mcp"
import { policyFirewallAbi } from "@/lib/abi"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const addresses = contractAddresses()
  const state = loadState()
  const deployed = contractsDeployed()

  const whitelistedVaults: Record<string, boolean> = {}
  let firewallStats: { totalGuardedVolume: string; totalBlockedAttempts: string } | null = null

  if (deployed) {
    const pub = chainClient()
    const catalog = vaultCatalog()
    // global whitelist state (no user needed)
    const whitelistRes = await Promise.allSettled(
      catalog.map((v) =>
        pub.readContract({ address: addresses.policyFirewall, abi: policyFirewallAbi as never, functionName: "whitelistedVault", args: [v.address] as never }),
      ),
    )
    catalog.forEach((v, i) => {
      whitelistedVaults[v.id] = whitelistRes[i].status === "fulfilled" ? Boolean(whitelistRes[i].value) : false
    })
    // global guarded-volume counters
    const [gv, ba] = await Promise.allSettled([
      pub.readContract({ address: addresses.policyFirewall, abi: policyFirewallAbi as never, functionName: "totalGuardedVolume" }),
      pub.readContract({ address: addresses.policyFirewall, abi: policyFirewallAbi as never, functionName: "totalBlockedAttempts" }),
    ])
    firewallStats = {
      totalGuardedVolume: gv.status === "fulfilled" ? String(gv.value) : "0",
      totalBlockedAttempts: ba.status === "fulfilled" ? String(ba.value) : "0",
    }
  }

  return jsonResponse({
    ok: true,
    network: { chainId: CHAIN_ID, name: CHAIN_NAME, rpcUrl: RPC_URL, explorer: EXPLORER_URL },
    deployed,
    contracts: addresses,
    vaultWhitelist: whitelistedVaults,
    firewallStats,
    policyDefaults: {
      maxPerTxSpend: POLICY_DEFAULTS.maxPerTxSpend.toString(),
      maxSlippageBps: POLICY_DEFAULTS.maxSlippageBps.toString(),
      requireWhitelistedVault: POLICY_DEFAULTS.requireWhitelistedVault,
      requireValidX402Attestation: POLICY_DEFAULTS.requireValidX402Attestation,
      emergencyPaused: POLICY_DEFAULTS.emergencyPaused,
    },
    skillEngine: { registry: SKILL_REGISTRY, runs: state.runs, observations: state.observations.length },
    x402: { sessionSpent: state.x402.sessionSpent, sessionBudgetCap: state.x402.sessionBudgetCap, payments: state.x402.ledger.length },
  })
}
