/**
 * src/lib/json.ts — BigInt-safe JSON serialization for every API route.
 *
 * JSON.stringify throws on BigInt ("Do not know how to serialize a BigInt").
 * The Sentinel agent runtime is BigInt-native (vault math MUST be exact), so
 * every route funnels responses through `jsonSafe` / `jsonResponse`:
 *   - bigint      -> string (lossless)
 *   - BigInt-like -> string
 *   - everything else falls through to standard JSON semantics
 */

export type JsonPrimitive = string | number | boolean | null | undefined

export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString()
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(jsonSafe)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = jsonSafe(v)
  }
  return out
}

export function serialize(value: unknown): string {
  return JSON.stringify(jsonSafe(value))
}

/** Next.js Response with BigInt-safe body + no-store cache (live desk data). */
export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(jsonSafe(value))
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  })
}

/** Parse a request body with BigInt-preserving revive for "…"-digit strings? No:
 *  numbers arrive as strings when bigint precision matters — parse helper. */
export function parseBigint(input: unknown): bigint | null {
  if (typeof input === "bigint") return input
  if (typeof input === "string" && /^-?\d+$/.test(input.trim())) {
    try {
      return BigInt(input.trim())
    } catch {
      return null
    }
  }
  if (typeof input === "number" && Number.isInteger(input)) return BigInt(input)
  return null
}
