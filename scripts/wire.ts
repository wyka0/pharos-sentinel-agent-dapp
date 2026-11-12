/**
 * scripts/wire.ts — post-deploy wiring (idempotent, run after adopt):
 *   1. whitelist 3 vaults on the Policy Firewall
 *   2. faucet sUSDC to the operator
 *   3. fund REAL yield reserves on all 3 vaults (solvent APY backing)
 *   4. register the 3 x402 paid providers in the oracle registry
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { publicClient, account, txLink } from "./lib"
import { parseUnits, type Address } from "viem"

const S = (n: number | string) => parseUnits(String(n), 6)

async function main() {
  const full = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".data", "deployments-full.json"), "utf8"))
  const { abis } = full
  const d = {
    susdc: full.susdc as Address,
    vaultTBill: full.vaultTBill as Address,
    vaultCredit: full.vaultCredit as Address,
    vaultHarbor: full.vaultHarbor as Address,
    oracleRegistry: full.oracleRegistry as Address,
    policyFirewall: full.policyFirewall as Address,
  }

  console.log("=== Pharos Sentinel wiring (Pharos Atlantic 688689) ===")
  console.log(`operator ${account.address}`)

  const write = async (label: string, address: Address, abi: any, fn: string, args: any[]) => {
    const hash = await (await import("./lib")).walletClient.writeContract({ address, abi, functionName: fn, args })
    const rcpt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(`${label} OK (gas ${rcpt.gasUsed}) ${txLink(hash)}`)
    return hash
  }

  const tryWrite = async (label: string, address: Address, abi: any, fn: string, args: any[]) => {
    try {
      return await write(label, address, abi, fn, args)
    } catch (e: any) {
      console.log(`${label} SKIPPED (${String(e?.message ?? e).split("\n")[0].slice(0, 90)})`)
      return null
    }
  }

  // 1. whitelist vaults
  await tryWrite("whitelist TBill", d.policyFirewall, abis.policyFirewall, "whitelistVault", [d.vaultTBill, true])
  await tryWrite("whitelist Credit", d.policyFirewall, abis.policyFirewall, "whitelistVault", [d.vaultCredit, true])
  await tryWrite("whitelist Harbor", d.policyFirewall, abis.policyFirewall, "whitelistVault", [d.vaultHarbor, true])

  // 2. faucet x2 (operator gets 20,000 sUSDC)
  await tryWrite("faucet #1", d.susdc, abis.susdc, "faucet", [])
  await tryWrite("faucet #2", d.susdc, abis.susdc, "faucet", [])

  // 3. approve vaults to pull reserve funding, then fund REAL yield reserves
  await tryWrite("approve TBill spend", d.susdc, abis.susdc, "approve", [d.vaultTBill, S(5000)])
  await tryWrite("approve Credit spend", d.susdc, abis.susdc, "approve", [d.vaultCredit, S(8000)])
  await tryWrite("approve Harbor spend", d.susdc, abis.susdc, "approve", [d.vaultHarbor, S(4000)])
  await tryWrite("fund TBill reserve 5000 sUSDC", d.vaultTBill, abis.vaultTBill, "fundYieldReserve", [S(5000)])
  await tryWrite("fund Credit reserve 8000 sUSDC", d.vaultCredit, abis.vaultCredit, "fundYieldReserve", [S(8000)])
  await tryWrite("fund Harbor reserve 4000 sUSDC", d.vaultHarbor, abis.vaultHarbor, "fundYieldReserve", [S(4000)])

  // 4. register x402 paid providers (fees in sUSDC base units: 0.025 / 0.025 / 0.015)
  await write("register TBillReserveAuditor", d.oracleRegistry, abis.oracleRegistry, "registerProvider", ["TBillReserveAuditor", "https://sentinel.local/api/x402/attestation?vault=tbill", 25_000n])
  await write("register CreditDefaultRiskFeed", d.oracleRegistry, abis.oracleRegistry, "registerProvider", ["CreditDefaultRiskFeed", "https://sentinel.local/api/x402/attestation?vault=credit", 25_000n])
  await write("register ComplianceKyaVerifier", d.oracleRegistry, abis.oracleRegistry, "registerProvider", ["ComplianceKyaVerifier", "https://sentinel.local/api/x402/attestation?vault=harbor", 15_000n])

  console.log("=== wiring complete ===")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
