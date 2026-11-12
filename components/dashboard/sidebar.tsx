"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Activity,
  BarChart3,
  Calendar,
  Landmark,
  Workflow,
  ShieldCheck,
  Settings,
  Search,
  Command,
  X,
  Wallet,
  LogIn,
} from "lucide-react"
import { ThemeToggle } from "./theme-toggle"
import { useAccount, useConnect, useDisconnect } from "wagmi"

const navItems = [
  { href: "/", label: "Pulse", icon: Activity, description: "Desk Overview" },
  { href: "/copilot", label: "Copilot", icon: Calendar, description: "Agent Intents" },
  { href: "/engine", label: "Engine", icon: BarChart3, description: "Trend + Yield" },
  { href: "/vaults", label: "Vaults", icon: Landmark, description: "RWA Pools" },
  { href: "/pipeline", label: "Pipeline", icon: Workflow, description: "4-Tool AI" },
  { href: "/firewall", label: "Firewall", icon: ShieldCheck, description: "Policy Guard" },
]

interface SidebarProps {
  onOpenCommand?: () => void
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ onOpenCommand, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={cn(
        "fixed left-0 top-0 h-screen w-64 flex flex-col border-r border-border bg-background z-50 transition-transform duration-300",
        "lg:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
      {/* Logo & Theme Toggle */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <Link href="/" className="flex items-center gap-3 group" onClick={onClose}>
            <div className="w-8 h-8 bg-lime flex items-center justify-center">
              <span className="text-background font-mono text-sm font-bold">S</span>
            </div>
            <span className="text-lg font-semibold tracking-tight">SENTINEL</span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1 hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <ThemeToggle />
      </div>

      {/* Search Trigger */}
      <div className="p-4">
        <button
          onClick={onOpenCommand}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground bg-surface border border-border hover:bg-surface-hover transition-colors"
        >
          <Search className="w-4 h-4" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="flex items-center gap-1 text-xs font-mono bg-background px-1.5 py-0.5 border border-border">
            <Command className="w-3 h-3" />K
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 text-sm transition-all group relative",
                isActive
                  ? "text-accent-foreground bg-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-lime lime-glow-sm" />
              )}
              <item.icon
                className={cn(
                  "w-4 h-4 transition-all",
                  isActive ? "text-accent-foreground" : ""
                )}
              />
              <span className="font-medium">{item.label}</span>
              <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {item.description}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom Section */}
      <div className="p-4 border-t border-border">
        <Link
          href="/settings"
          onClick={onClose}
          className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>

        {/* Wallet — 1-click connect for reviewers */}
        <div className="mt-4 px-3">
          {isConnected ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-surface border border-border flex items-center justify-center">
                <Wallet className="w-4 h-4 text-accent-ink" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{short}</p>
                <p className="text-xs text-muted-foreground truncate">Non-Custodial Signer</p>
              </div>
              <button
                onClick={() => disconnect()}
                title="Disconnect"
                className="text-[10px] font-mono text-muted-foreground hover:text-destructive border border-border px-1.5 py-1 hover:border-destructive/40 transition-colors"
              >
                EXIT
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                const injected = connectors.find((c) => c.id === "injected") ?? connectors[0]
                if (injected) connect({ connector: injected })
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm bg-lime/10 border border-lime/30 text-accent-ink hover:bg-lime/20 transition-colors group"
            >
              <LogIn className="w-4 h-4" />
              <span className="flex-1 text-left font-medium">Connect Wallet</span>
              <span className="text-[10px] font-mono opacity-70 group-hover:opacity-100">REVIEWER DEMO</span>
            </button>
          )}
        </div>
      </div>
    </aside>
    </>
  )
}
