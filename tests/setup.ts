/**
 * tests/setup.ts — shared test environment.
 * Isolates SkillEngine disk state per test run (a fresh dir triggers the
 * deterministic cold-start seed from evidence/, mirroring a fresh serverless
 * instance) and forces "not deployed" contract addresses so no test ever
 * touches live RPC unless it opts in.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-tests-"))
process.env.SENTINEL_DATA_DIR = tmp
// neutralize any deployed addresses picked up from the real .env.local
for (const k of [
  "PHAROS_SENTINEL_SUSD_ADDRESS",
  "PHAROS_SENTINEL_VAULT_TBILL_ADDRESS",
  "PHAROS_SENTINEL_VAULT_CREDIT_ADDRESS",
  "PHAROS_SENTINEL_VAULT_HARBOR_ADDRESS",
  "PHAROS_SENTINEL_ORACLE_REGISTRY_ADDRESS",
  "PHAROS_SENTINEL_POLICY_FIREWALL_ADDRESS",
]) {
  process.env[k] = "0x0000000000000000000000000000000000000000"
}
process.env.PHAROS_RPC_URL = "http://127.0.0.1:1" // offline
