/**
 * scripts/adopt-deployment.ts — adopt the already-deployed contract suite
 * (deployment run of record) and persist addresses to .data + .env.local.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { saveDeployment, txLink } from "./lib"

const deployment = {
  network: "pharos-atlantic-testnet",
  chainId: 688689,
  deployedAt: new Date().toISOString(),
  deployer: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C",
  susdc: "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b",
  vaultTBill: "0x001ef1ebebe4167dc0645e33875e9235c7dfaf78",
  vaultCredit: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
  vaultHarbor: "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77",
  oracleRegistry: "0x303ab8dbc96b7a5ce175b0096ebcea7656fc189f",
  policyFirewall: "0x4bf82bc533befdafa0a0d2154842394b37a40ea1",
  deployTxs: {
    susdc: txLink("0x26da7c4a04c5f77c4e5f75dbf02f239a39a8daa389fb01a1d6e71defe524f681"),
    vaultTBill: txLink("0x3b59b5eae1daea13b462993f69c7801096579b2f7e64570d8fdfedf3be9151d3"),
    vaultCredit: txLink("0xcbf1656dbabb071b1df166c890a3432684260af3a2cb341f5084b1b327d01745"),
    vaultHarbor: txLink("0xbfc6ccc45fdb132239747723ea5f6f1342ff4865cca892a6bec8786a25e160eb"),
    oracleRegistry: txLink("0x63b9a86ed966cc7426838a8e9b0371ce919ce0cb47bfee63842e909395ddbef9"),
    policyFirewall: txLink("0xc75190f147448970ddc5d7496da14a98fcedee15ac9d398f7958a12311302109"),
  },
}

// attach ABIs from artifacts for downstream scripts
const artifacts = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".build", "sentinel.json"), "utf8"))
const abiOf = (name: string) => artifacts[name].abi
const full = {
  ...deployment,
  abis: {
    susdc: abiOf("SentinelUSD"),
    vaultTBill: abiOf("PharosTBillRwaVault"),
    vaultCredit: abiOf("AtlanticSeniorCreditVault"),
    vaultHarbor: abiOf("HarborBufferLendingPool"),
    oracleRegistry: abiOf("SentinelX402OracleRegistry"),
    policyFirewall: abiOf("SentinelPolicyFirewall"),
  },
}

saveDeployment(deployment)
fs.writeFileSync(path.join(__dirname, "..", ".data", "deployments-full.json"), JSON.stringify(full, null, 2))
console.log("adopted deployment of record OK")
