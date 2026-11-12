/**
 * scripts/lib.ts — shared server-side helpers for deploy/verify scripts.
 * NOTE: private keys are ONLY ever loaded here (scripts/), never in src/.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createPublicClient, createWalletClient, http, defineChain, type Address } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import dotenv from "dotenv"

export const ROOT = path.resolve(__dirname, "..")

dotenv.config({ path: path.join(ROOT, ".env.local") })
dotenv.config({ path: path.join(ROOT, ".env") })

export const RPC_URL = process.env.PHAROS_RPC_URL || "https://atlantic.dplabs-internal.com"
export const CHAIN_ID = Number(process.env.PHAROS_CHAIN_ID || 688689)
export const EXPLORER = (process.env.PHAROS_EXPLORER_URL || "https://atlantic.pharosscan.xyz").replace(/\/$/, "")

/** Pharos Atlantic Testnet chain definition (viem). */
export const pharosAtlantic = defineChain({
  id: CHAIN_ID,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "PharosScan", url: EXPLORER } },
})

export const TEST_USER_PRIVATE_KEY = process.env.TEST_USER_PRIVATE_KEY as `0x${string}` | undefined

if (!TEST_USER_PRIVATE_KEY) {
  console.error("FATAL: TEST_USER_PRIVATE_KEY missing from .env.local")
  process.exit(1)
}

export const account = privateKeyToAccount(TEST_USER_PRIVATE_KEY)

export const publicClient = createPublicClient({ chain: pharosAtlantic, transport: http(RPC_URL, { timeout: 30_000 }) })
export const walletClient = createWalletClient({ account, chain: pharosAtlantic, transport: http(RPC_URL, { timeout: 30_000 }) })

export const txLink = (hash: string) => `${EXPLORER}/tx/${hash}`
export const addrLink = (a: string) => `${EXPLORER}/address/${a}`

/** Deploy a contract from .build/sentinel.json artifacts. */
export async function deployContract(name: string, args: any[] = []) {
  const artifacts = JSON.parse(fs.readFileSync(path.join(ROOT, ".build", "sentinel.json"), "utf8"))
  const c = artifacts[name]
  if (!c) throw new Error(`artifact ${name} not found — run npm run compile first`)
  const hash = await walletClient.deployContract({
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}` as `0x${string}`,
    args,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`deploy ${name} failed: ${hash}`)
  const address = receipt.contractAddress as Address
  console.log(`deployed ${name} @ ${address} (gas ${receipt.gasUsed}) tx ${txLink(hash)}`)
  return { name, address, hash, gasUsed: receipt.gasUsed, abi: c.abi }
}

/** Persist deployment record (addresses + txs) for the verify script & UI. */
export function saveDeployment(deployment: any) {
  const dataDir = path.join(ROOT, ".data")
  fs.mkdirSync(dataDir, { recursive: true })
  const file = path.join(dataDir, "deployments.json")
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2))

  // Also sync addresses into .env.local so the Next.js server picks them up.
  const envPath = path.join(ROOT, ".env.local")
  let env = fs.readFileSync(envPath, "utf8")
  const map: Record<string, string> = {
    PHAROS_SENTINEL_SUSD_ADDRESS: deployment.susdc,
    PHAROS_SENTINEL_VAULT_TBILL_ADDRESS: deployment.vaultTBill,
    PHAROS_SENTINEL_VAULT_CREDIT_ADDRESS: deployment.vaultCredit,
    PHAROS_SENTINEL_VAULT_HARBOR_ADDRESS: deployment.vaultHarbor,
    PHAROS_SENTINEL_ORACLE_REGISTRY_ADDRESS: deployment.oracleRegistry,
    PHAROS_SENTINEL_POLICY_FIREWALL_ADDRESS: deployment.policyFirewall,
  }
  for (const [k, v] of Object.entries(map)) {
    const re = new RegExp(`^${k}=.*$`, "m")
    if (re.test(env)) env = env.replace(re, `${k}=${v}`)
    else env += `\n${k}=${v}`
  }
  fs.writeFileSync(envPath, env)
  console.log(`deployment saved -> .data/deployments.json + .env.local updated`)
}
