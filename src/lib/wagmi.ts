/**
 * src/lib/wagmi.ts — browser wallet connection (wagmi v2), NON-CUSTODIAL.
 * The user's MetaMask/injected wallet is the ONLY signer in the UI.
 * No key material exists in this file or anywhere in src/.
 */
import { createConfig, http } from "wagmi"
import { defineChain } from "viem"
import { injected } from "wagmi/connectors"

export const pharosAtlanticChain = defineChain({
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_PHAROS_RPC_URL || "https://atlantic.dplabs-internal.com"] } },
  blockExplorers: { default: { name: "PharosScan", url: process.env.NEXT_PUBLIC_PHAROS_EXPLORER_URL || "https://atlantic.pharosscan.xyz" } },
})

export const wagmiConfig = createConfig({
  chains: [pharosAtlanticChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [pharosAtlanticChain.id]: http() },
})

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig
  }
}
