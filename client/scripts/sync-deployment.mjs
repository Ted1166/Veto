import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const deployments = resolve(here, '../../contracts/deployments')
const target = resolve(here, '../src/deployment.ts')

function read(name) {
    const file = resolve(deployments, name)
    if (!existsSync(file)) {
        if (existsSync(target)) {
            console.warn(`${file} not found, keeping the existing src/deployment.ts`)
            process.exit(0)
        }
        console.error(`${file} not found. Deploy the contracts first.`)
        process.exit(1)
    }
    return JSON.parse(readFileSync(file, 'utf8'))
}

const fixtures = read('fixtures.json')
const guard = read('guard.json')
const reactive = read('reactive.json')

const deployment = {
    chainId: Number(fixtures.chainId),
    rpcUrl: process.env.VITE_RPC_URL ?? 'https://sepolia.base.org',
    explorer: process.env.VITE_EXPLORER ?? 'https://sepolia.basescan.org',
    guard: guard.guard,
    vault: fixtures.vault,
    pool: fixtures.pool,
    riskToken: fixtures.riskToken,
    stableToken: fixtures.stableToken,
    reactive: reactive.reactive,
    decisionWindow: Number(guard.decisionWindow)
}

writeFileSync(target, `export const deployment = ${JSON.stringify(deployment, null, 2)} as const\n`)
console.log(`wrote ${target}`)
