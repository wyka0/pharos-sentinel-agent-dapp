/**
 * scripts/compile.ts — compile contracts/PharosSentinelSuite.sol with solc-js
 * (optimizer ON, 200 runs) and cache artifacts to .build/sentinel.json
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, "..")
const OUT = path.join(ROOT, ".build", "sentinel.json")

async function main() {
  const solc = require("solc")
  const sourcePath = "PharosSentinelSuite.sol"
  const source = fs.readFileSync(path.join(ROOT, "contracts", sourcePath), "utf8")

  const input = {
    language: "Solidity",
    sources: { [sourcePath]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
      },
    },
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))

  if (output.errors) {
    const errors = output.errors.filter((e: any) => e.severity === "error")
    for (const e of output.errors) console.error(e.formattedMessage)
    if (errors.length > 0) process.exit(1)
  }

  const contracts = output.contracts[sourcePath]
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(contracts, null, 2))

  for (const [name, c] of Object.entries<any>(contracts)) {
    const bytes = c.evm.bytecode.object.length / 2
    console.log(`compiled ${name}: ${(bytes / 1024).toFixed(2)} KB bytecode, abi entries ${c.abi.length}`)
  }
  console.log(`artifacts -> ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
