"use client"

/**
 * /settings — WALLET CONNECTION & NETWORK (template mapping: settings page).
 * wagmi/injected wallet connection to Pharos Atlantic Testnet (688689),
 * theme toggle, deployment status.
 */
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { useDashboard } from "@/context/dashboard-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/dashboard/theme-toggle"
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi"
import { pharosAtlanticChain } from "@/lib/wagmi"
import { Wallet, LogOut, Network, ShieldCheck, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

function SettingsInner() {
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { system } = useDashboard()
  const wrongChain = isConnected && chainId !== 688689

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 bg-lime pulse-live" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Settings</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Wallet & Network</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1">
          Connect the wallet that will sign every Prepared Action Bundle. The Sentinel agent NEVER holds keys.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Wallet */}
        <div className="bg-card border border-border p-4 md:p-6">
          <h2 className="text-sm font-medium mb-4 flex items-center gap-2"><Wallet className="w-4 h-4 text-lime" /> Signer Wallet</h2>
          {!isConnected ? (
            <div className="space-y-2">
              {connectors.map((c) => (
                <Button key={c.uid} variant="outline" className="w-full justify-start gap-2 bg-transparent" onClick={() => connect({ connector: c })}>
                  <Wallet className="w-4 h-4" /> Connect {c.name}
                </Button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-surface border border-border p-3 font-mono text-xs break-all">{address}</div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn("font-mono text-[10px]", wrongChain ? "text-destructive border-destructive/30" : "text-lime border-lime/30")}>
                  {wrongChain ? `WRONG CHAIN (${chainId})` : `CHAIN ${chainId}`}
                </Badge>
                {wrongChain && (
                  <Button size="sm" variant="outline" className="bg-transparent" onClick={() => switchChain({ chainId: pharosAtlanticChain.id })}>
                    Switch to 688689
                  </Button>
                )}
              </div>
              <Button variant="outline" className="w-full gap-2 bg-transparent" onClick={() => disconnect()}>
                <LogOut className="w-4 h-4" /> Disconnect
              </Button>
            </div>
          )}
        </div>

        {/* Network */}
        <div className="bg-card border border-border p-4 md:p-6">
          <h2 className="text-sm font-medium mb-4 flex items-center gap-2"><Network className="w-4 h-4 text-lime" /> Pharos Atlantic Testnet</h2>
          <dl className="space-y-2 text-xs font-mono">
            <Row k="chainId" v="688689 (0xA8271)" />
            <Row k="rpc" v={system?.network.rpcUrl ?? "https://atlantic.dplabs-internal.com"} />
            <Row k="explorer" v={system?.network.explorer ?? "https://atlantic.pharosscan.xyz"} />
            <Row k="currency" v="PHRS (18 decimals)" />
            <Row k="suite deployed" v={system?.deployed ? "YES (6 contracts)" : "NO — npm run deploy"} />
          </dl>
          <a href={`${system?.network.explorer}/address/${system?.contracts.policyFirewall}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs font-mono text-lime hover:underline">
            <ExternalLink className="w-3.5 h-3.5" /> View SentinelPolicyFirewall on PharosScan
          </a>
        </div>

        {/* Theme */}
        <div className="bg-card border border-border p-4 md:p-6">
          <h2 className="text-sm font-medium mb-4">Appearance</h2>
          <ThemeToggle />
        </div>

        {/* Safety */}
        <div className="bg-card border border-border p-4 md:p-6">
          <h2 className="text-sm font-medium mb-4 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-lime" /> Safety Architecture</h2>
          <ul className="space-y-2 text-xs text-muted-foreground list-disc pl-4">
            <li>Zero private keys in the agent runtime (src/) — canary-scanned on every audit.</li>
            <li>All fund movement = Prepared Action Bundles signed by YOUR wallet.</li>
            <li>On-chain Policy Firewall re-verifies every bundle (5 atomic guards).</li>
            <li>x402 micropayments signed EIP-3009 by the user, idempotency-keyed, nonce-replay protected.</li>
            <li>Promise.allSettled fault isolation: one broken vault never blocks the desk.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate max-w-64" title={v}>{v}</dd>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <SettingsInner />
    </DashboardLayout>
  )
}
