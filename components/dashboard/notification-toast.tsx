"use client"

/**
 * Self-contained toast system (no context dependency): module-level
 * pub/sub so any page can push agent notifications.
 */
import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

const iconMap = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
}

const colorMap = {
  success: "bg-lime/10 text-lime border-lime/20",
  warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  error: "bg-red-500/10 text-red-500 border-red-500/20",
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
}

export type ToastType = keyof typeof iconMap

export interface SentinelNotification {
  id: string
  type: ToastType
  title: string
  message: string
}

type Listener = (n: SentinelNotification[]) => void
let notifications: SentinelNotification[] = []
const listeners = new Set<Listener>()

export function pushNotification(type: ToastType, title: string, message: string) {
  const n: SentinelNotification = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, title, message }
  notifications = [...notifications, n].slice(-4)
  listeners.forEach((l) => l(notifications))
  setTimeout(() => dismissNotification(n.id), 6000)
}

export function dismissNotification(id: string) {
  notifications = notifications.filter((n) => n.id !== id)
  listeners.forEach((l) => l(notifications))
}

export function NotificationToast() {
  const [items, setItems] = useState<SentinelNotification[]>(notifications)
  useEffect(() => {
    const l: Listener = (n) => setItems(n)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence mode="popLayout">
        {items.map((notification) => {
          const Icon = iconMap[notification.type]
          return (
            <motion.div
              key={notification.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={cn("flex items-start gap-3 p-3 border backdrop-blur-xl min-w-72", colorMap[notification.type])}
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{notification.title}</p>
                <p className="text-xs opacity-80">{notification.message}</p>
              </div>
              <button onClick={() => dismissNotification(notification.id)} className="p-0.5 hover:opacity-70">
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
