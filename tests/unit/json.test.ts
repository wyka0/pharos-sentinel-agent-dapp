/**
 * tests/unit/json.test.ts — BigInt-safe JSON serialization.
 */
import { describe, it, expect } from "vitest"
import { jsonSafe, serialize, jsonResponse, parseBigint } from "@/lib/json"

describe("jsonSafe — bigint handling", () => {
  it("serializes a plain bigint to string", () => {
    expect(jsonSafe(123n)).toBe("123")
  })
  it("serializes zero bigint", () => {
    expect(jsonSafe(0n)).toBe("0")
  })
  it("serializes max uint256 bigint losslessly", () => {
    const max = 2n ** 256n - 1n
    expect(jsonSafe(max)).toBe("115792089237316195423570985008687907853269984665640564039457584007913129639935")
  })
  it("serializes negative bigint", () => {
    expect(jsonSafe(-42n)).toBe("-42")
  })
  it("serializes bigint nested in object", () => {
    expect(jsonSafe({ a: 1n, b: "x" })).toEqual({ a: "1", b: "x" })
  })
  it("serializes bigint nested in array", () => {
    expect(jsonSafe([1n, 2n, 3n])).toEqual(["1", "2", "3"])
  })
  it("serializes bigint deeply nested", () => {
    expect(jsonSafe({ a: { b: { c: [5n] } } })).toEqual({ a: { b: { c: ["5"] } } })
  })
  it("preserves null / undefined / booleans", () => {
    expect(jsonSafe(null)).toBeNull()
    expect(jsonSafe(undefined)).toBeUndefined()
    expect(jsonSafe(true)).toBe(true)
  })
  it("preserves numbers (including unsafe-precision ones untouched)", () => {
    expect(jsonSafe(1.5)).toBe(1.5)
    expect(jsonSafe(0)).toBe(0)
  })
  it("preserves strings", () => {
    expect(jsonSafe("hello")).toBe("hello")
  })
  it("handles empty object and array", () => {
    expect(jsonSafe({})).toEqual({})
    expect(jsonSafe([])).toEqual([])
  })
  it("handles Map-like plain object with many keys", () => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) obj[`k${i}`] = BigInt(i)
    const out = jsonSafe(obj) as Record<string, string>
    expect(Object.keys(out)).toHaveLength(100)
    expect(out.k99).toBe("99")
  })
})

describe("serialize — JSON.stringify integration", () => {
  it("does not throw on bigint (vanilla stringify throws)", () => {
    expect(() => JSON.stringify({ x: 1n })).toThrow()
    expect(() => serialize({ x: 1n })).not.toThrow()
  })
  it("produces valid JSON parseable output", () => {
    const parsed = JSON.parse(serialize({ amount: 2_500_000_000n, vault: "credit" }))
    expect(parsed.amount).toBe("2500000000")
    expect(parsed.vault).toBe("credit")
  })
  it("roundtrips through parseBigint", () => {
    const s = serialize({ amount: 7777n })
    const parsed = JSON.parse(s)
    expect(parseBigint(parsed.amount)).toBe(7777n)
  })
})

describe("parseBigint", () => {
  it("parses numeric strings", () => {
    expect(parseBigint("123")).toBe(123n)
  })
  it("parses negative numeric strings", () => {
    expect(parseBigint("-9")).toBe(-9n)
  })
  it("parses very large strings", () => {
    expect(parseBigint("1" + "0".repeat(40))).toBe(10n ** 40n)
  })
  it("parses actual bigint input", () => {
    expect(parseBigint(5n)).toBe(5n)
  })
  it("parses integer numbers", () => {
    expect(parseBigint(42)).toBe(42n)
  })
  it("rejects non-numeric strings", () => {
    expect(parseBigint("abc")).toBeNull()
  })
  it("rejects floats", () => {
    expect(parseBigint("1.5")).toBeNull()
  })
  it("rejects objects", () => {
    expect(parseBigint({})).toBeNull()
  })
  it("rejects null", () => {
    expect(parseBigint(null)).toBeNull()
  })
  it("accepts padded numeric strings", () => {
    expect(parseBigint(" 42 ")).toBe(42n)
  })
})

describe("jsonResponse — Response shape", () => {
  it("returns a Response with application/json content-type", async () => {
    const res = jsonResponse({ ok: true, value: 1n })
    expect(res).toBeInstanceOf(Response)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
  it("body contains stringified bigint", async () => {
    const res = jsonResponse({ v: 9n })
    expect(await res.text()).toBe('{"v":"9"}')
  })
  it("honors custom status", () => {
    expect(jsonResponse({ error: "x" }, { status: 402 }).status).toBe(402)
  })
  it("merges extra headers", () => {
    const res = jsonResponse({}, { headers: { "x-payment-required": "challenge" } })
    expect(res.headers.get("x-payment-required")).toBe("challenge")
  })
})
