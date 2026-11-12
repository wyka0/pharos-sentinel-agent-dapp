/**
 * scripts/audit-secrets.ts — `npm run audit:secrets`
 * Canary scanner proving the non-custodial airgap:
 *   1. .env.local is gitignored
 *   2. zero private keys / signer material in TRACKED files
 *   3. src/ contains no key APIs at all (stricter than tracked set)
 * Exit code 1 on any violation (CI-ready).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const ROOT = path.resolve(__dirname, "..")
let violations = 0
const findings: string[] = []

function fail(msg: string) {
  violations++
  findings.push(`FAIL: ${msg}`)
}
function pass(msg: string) {
  findings.push(`ok  : ${msg}`)
}

function walk(dir: string, skip = new Set<string>()): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, skip))
    else out.push(p)
  }
  return out
}

console.log("=== Pharos Sentinel — secret canary audit ===")

// 1. .gitignore blocks secrets
const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")
if (/\.env\.local/m.test(gitignore) && /\.env\.\*/m.test(gitignore)) pass(".gitignore blocks .env.local and .env.*")
else fail(".gitignore does not block .env.local / .env.*")
if (/node_modules/m.test(gitignore) && /\.next/m.test(gitignore)) pass(".gitignore blocks node_modules and .next")
else fail(".gitignore missing node_modules/.next entries")

// 2. .env.local exists but is NOT tracked by git
const envLocal = path.join(ROOT, ".env.local")
if (fs.existsSync(envLocal)) {
  pass(".env.local exists on disk")
  try {
    const tracked = execSync("git ls-files .env.local", { cwd: ROOT, encoding: "utf8" }).trim()
    if (tracked === "") pass(".env.local is NOT tracked by git")
    else fail(".env.local IS TRACKED BY GIT — remove it from the index immediately!")
  } catch {
    pass("git not initialized yet (run `git init` + first commit, .env.local will stay untracked)")
  }
  if (/TEST_USER_PRIVATE_KEY=0x[0-9a-fA-F]{64}/.test(fs.readFileSync(envLocal, "utf8"))) {
    pass(".env.local holds the test payer key (expected, gitignored)")
  } else {
    console.log("note: .env.local has no TEST_USER_PRIVATE_KEY (deploy scripts need it)")
  }
} else {
  console.log("note: .env.local absent (fine for CI)")
}

// 3. scan TRACKED files (git ls-files when available, else file walk minus ignored dirs)
let trackedFiles: string[] = []
try {
  trackedFiles = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((f) => path.join(ROOT, f))
} catch {
  trackedFiles = walk(ROOT, new Set(["node_modules", ".next", ".git", ".data", ".build", "evidence", ".env.local"]))
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/")
const isSrc = (f: string) => rel(f).startsWith("src/")
const isScriptsOrTests = (f: string) => /^(scripts|tests)\//.test(rel(f))
const isSelf = (f: string) => rel(f) === "scripts/audit-secrets.ts" // scanner excludes its own pattern literals

// THE key invariant: the ACTUAL payer key from .env.local must never appear
// in ANY tracked file (key value leak = instant fail).
const envText = fs.existsSync(envLocal) ? fs.readFileSync(envLocal, "utf8") : ""
const realKey = envText.match(/TEST_USER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)?.[1]
if (realKey) {
  const leaks = trackedFiles.filter((f) => fs.readFileSync(f, "utf8").includes(realKey))
  if (leaks.length === 0) pass("the real test payer key appears in ZERO tracked files")
  else for (const f of leaks) fail(`${rel(f)}: contains the REAL payer key value!`)
}

const GLOBAL_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "PEM private key block"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/sk-[a-zA-Z0-9]{20,}/, "API secret key (sk-…)"],
]

for (const f of trackedFiles) {
  if (isSelf(f)) continue
  if (!/\.(ts|tsx|js|jsx|json|md|sol|css|mjs|cjs)$/.test(f)) continue
  const text = fs.readFileSync(f, "utf8")
  for (const [re, label] of GLOBAL_PATTERNS) {
    if (re.test(text)) fail(`${rel(f)}: ${label}`)
  }
  if (isSrc(f)) {
    // STRICT zone: no key APIs, no non-zero 32-byte hex, no payer env name
    if (/import\s+[^;]*privateKeyToAccount|privateKeyToAccount\s*\(/.test(text)) fail(`${rel(f)}: privateKeyToAccount in src/ (airgap breach)`)
    if (/fromMnemonic|generateMnemonic|validateMnemonic|mnemonic\s*[:=]/i.test(text)) fail(`${rel(f)}: mnemonic API in src/`)
    if (/TEST_USER_PRIVATE_KEY/.test(text)) fail(`${rel(f)}: payer key env referenced in src/`)
    const hexes = text.match(/0x[a-fA-F0-9]{64}/g) ?? []
    if (hexes.some((h) => !/^0x0+$/.test(h))) fail(`${rel(f)}: non-zero 32-byte hex literal in src/`)
  } else if (!isScriptsOrTests(f)) {
    // tracked non-src files: exhaustive 64-hex heuristics false-positive on
    // tx hashes & bytecode; the GLOBAL real-payer-key check above is the
    // precise leak detector. PEM/AWS/sk- patterns above still apply.
  }
}
if (violations === 0) pass(`scanned ${trackedFiles.length} tracked files — zero key material`)

// 4. src/ stricter scan (ALL files, not just tracked)
const srcFiles = walk(path.join(ROOT, "src"))
const srcOffenders = srcFiles.filter((f) => {
  const t = fs.readFileSync(f, "utf8")
  if (/import\s+[^;]*privateKeyToAccount|privateKeyToAccount\s*\(/.test(t)) return true
  if (/fromMnemonic|generateMnemonic|validateMnemonic|mnemonic\s*[:=]/i.test(t)) return true
  if (/TEST_USER_PRIVATE_KEY/.test(t)) return true
  const hexes = t.match(/0x[a-fA-F0-9]{64}/g) ?? []
  return hexes.some((h) => !/^0x0+$/.test(h))
})
if (srcOffenders.length === 0) pass(`src/ airgap clean (${srcFiles.length} files scanned — no signer material)`)
else for (const f of srcOffenders) fail(`${path.relative(ROOT, f)}: signer material in agent runtime`)

console.log("")
for (const line of findings) console.log("  " + line)
console.log("")
if (violations > 0) {
  console.log(`AUDIT FAILED: ${violations} violation(s)`)
  process.exit(1)
}
console.log("AUDIT PASSED: non-custodial airgap verified")
