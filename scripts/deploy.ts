/**
 * scripts/deploy.ts — compile & deploy the PharosSentinelSuite to
 * Pharos Atlantic Testnet (688689), then wire everything together:
 *   - whitelist 3 vaults on the Policy Firewall
 *   - fund each vault's REAL yield reserve (solvent APY backing)
 *   - register the 3 x402 paid providers in the oracle registry
 */
import { publicClient, account, deployContract, saveDeployment, txLink } from "./lib"
import { formatEther, parseUnits, type Address } from "viem"

const S = (n: number | string) => parseUnits(String(n), 6) // sUSDC has 6 decimals

async function main() {
  console.log("=== Pharos Sentinel deployment on Pharos Atlantic Testnet (688689) ===")
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`deployer ${account.address} | PHRS balance: ${formatEther(balance)}`)
  if (balance < parseUnits("0.05", 18)) {
    console.error("FATAL: PHRS balance too low for deployment suite. Fund the wallet first.")
    process.exit(1)
  }

  // 1. settlement asset
  const susdc = await deployContract("SentinelUSD")

  // 2. three distinct vaults
  const vaultTBill = await deployContract("PharosTBillRwaVault", [susdc.address])
  const vaultCredit = await deployContract("AtlanticSeniorCreditVault", [susdc.address])
  const vaultHarbor = await deployContract("HarborBufferLendingPool", [susdc.address])

  // 3. x402 oracle registry + policy firewall
  const oracleRegistry = await deployContract("SentinelX402OracleRegistry")
  const policyFirewall = await deployContract("SentinelPolicyFirewall", [susdc.address, oracleRegistry.address])

  const deployment = {
    network: "pharos-atlantic-testnet",
    chainId: 688689,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    susdc: susdc.address,
    vaultTBill: vaultTBill.address,
    vaultCredit: vaultCredit.address,
    vaultHarbor: vaultHarbor.address,
    oracleRegistry: oracleRegistry.address,
    policyFirewall: policyFirewall.address,
    deployTxs: {
      susdc: txLink(susdc.hash),
      vaultTBill: txLink(vaultTBill.hash),
      vaultCredit: txLink(vaultCredit.hash),
      vaultHarbor: txLink(vaultHarbor.hash),
      oracleRegistry: txLink(oracleRegistry.hash),
      policyFirewall: txLink(policyFirewall.hash),
    },
  }

  // helper to write contract calls
  const write = async (label: string, address: Address, abi: any, fn: string, args: any[]) => {
    const { walletClient: wc } = await import("./lib")
    const hash = await wc.writeContract({ address, abi, functionName: fn, args })
    const rcpt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(`${label} OK (gas ${rcpt.gasUsed}) ${txLink(hash)}`)
    return hash
  }

  // 4. whitelist the three vaults on the firewall
  await write("whitelist TBill", policyFirewall.address as Address, policyFirewall.abi, "whitelistVault", [vaultTBill.address, true])
  await write("whitelist Credit", policyFirewall.address as Address, policyFirewall.abi, "whitelistVault", [vaultCredit.address, true])
  await write("whitelist Harbor", policyFirewall.address as Address, policyFirewall.abi, "whitelistVault", [vaultHarbor.address, true])

  // 5. mint sUSDC to deployer & fund REAL yield reserves (solvent APY)
  await write("faucet 1", susdc.address as Address, susdc.abi, "faucet", [])
  await write("faucet 2", susdc.address as Address, susdc.abi, "faucet", [])

  // Reserve funding (surplus above principal => yield never unbacked):
  await write("fund TBill reserve 5000 sUSDC", vaultTBill.address as Address, vaultTBill.abi, "fundYieldReserve", [S(5000)])
  await write("fund Credit reserve 8000 sUSDC", vaultCredit.address as Address, vaultCredit.abi, "fundYieldReserve", [S(8000)])
  await write("fund Harbor reserve 4000 sUSDC", vaultHarbor.address as Address, vaultHarbor.abi, "fundYieldReserve", [S(4000)])

  // 6. register the three x402 paid providers
  await write("register TBillReserveAuditor", oracleRegistry.address as Address, oracleRegistry.abi, "registerProvider", ["TBillReserveAuditor", "https://sentinel.local/api/x402/attestation?vault=tbill", 25_000n]) // 0.025 sUSDC
  await write("register CreditDefaultRiskFeed", oracleRegistry.address as Address, oracleRegistry.abi, "registerProvider", ["CreditDefaultRiskFeed", "https://sentinel.local/api/x402/attestation?vault=credit", 25_000n])
  await write("register ComplianceKyaVerifier", oracleRegistry.address as Address, oracleRegistry.abi, "registerProvider", ["ComplianceKyaVerifier", "https://sentinel.local/api/x402/attestation?vault=harbor", 15_000n])

  saveDeployment(deployment)
  console.log("=== deployment complete ===")
  console.log(JSON.stringify(deployment, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
