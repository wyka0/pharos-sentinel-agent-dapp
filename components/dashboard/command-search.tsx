"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Activity,
  BarChart3,
  Calendar,
  ImageIcon,
  Users,
  Wallet,
  FileText,
  TrendingUp,
  Search,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"

const pages = [
  { name: "Sentinel Pulse — Desk Overview", href: "/", icon: Activity },
  { name: "Agent Intent Copilot", href: "/copilot", icon: Calendar },
  { name: "Trend Memory & Net-Yield Engine", href: "/engine", icon: BarChart3 },
  { name: "RWA & DeFi Vaults", href: "/vaults", icon: ImageIcon },
  { name: "4-Tool Execution Pipeline", href: "/pipeline", icon: Users },
  { name: "Policy Firewall & Signing", href: "/firewall", icon: Wallet },
  { name: "Settings & Wallet", href: "/settings", icon: FileText },
]

const quickActions = [
  { name: "New Agent Mandate (Copilot)", action: "new-mandate", icon: FileText },
  { name: "View Top Net-Yield Venue", action: "top-performers", icon: TrendingUp },
  { name: "Open PharosScan Explorer", action: "explorer", icon: FileText },
]

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter()

  const handleSelect = useCallback(
    (value: string) => {
      onOpenChange(false)
      if (value.startsWith("/")) {
        router.push(value)
      }
    },
    [router, onOpenChange]
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search commands, pages, mandates..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((page) => (
            <CommandItem
              key={page.href}
              value={page.name}
              onSelect={() => handleSelect(page.href)}
              className="flex items-center gap-3 cursor-pointer"
            >
              <page.icon className="w-4 h-4 text-muted-foreground" />
              <span>{page.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          {quickActions.map((action) => (
            <CommandItem
              key={action.action}
              value={action.name}
              className="flex items-center gap-3 cursor-pointer"
            >
              <action.icon className="w-4 h-4 text-muted-foreground" />
              <span>{action.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

export function useCommandSearch() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return { open, setOpen }
}
