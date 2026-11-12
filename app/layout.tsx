import type { Metadata } from "next"
import { Providers } from "@/components/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Pharos Sentinel — Autonomous RWA Due-Diligence & Policy-Guarded Execution Desk",
  description:
    "Agent-native dApp on Pharos Atlantic Testnet (688689): autonomous RWA due-diligence, portfolio concierge and on-chain Policy-Guarded execution. 4 Pharos AI tools: Chain MCP, Docs MCP, x402 paid oracle, SkillEngine.",
  icons: { icon: "/icon.svg" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
