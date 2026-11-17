import { parseAbiItem } from 'viem'
import { createContext } from './clients.js'
import { sleep } from './lib/chain.js'
import { computeHops } from './lib/latency.js'
import { appendTrace, markdownPath } from './lib/store.js'
import { traceAction } from './lib/trace.js'

const resolved = parseAbiItem(
    'event ActionResolved(uint256 indexed id, uint8 status, uint16 executedBps, uint256 stableReceived)'
)

async function main() {
    const ctx = createContext()
    let cursor = await ctx.origin.getBlockNumber()
    console.log(`indexing ${ctx.deployment.guard} from block ${cursor}, writing ${markdownPath()}`)

    for (; ;) {
        await sleep(2_000)
        const latest = await ctx.origin.getBlockNumber()
        if (latest <= cursor) continue
        const logs = await ctx.origin.getLogs({
            address: ctx.deployment.guard,
            event: resolved,
            fromBlock: cursor + 1n,
            toBlock: latest
        })
        cursor = latest

        for (const log of logs) {
            const id = Number(log.args.id)
            await sleep(3_000)
            const trace = await traceAction(ctx, id, { scenario: 'live' })
            appendTrace(trace)
            console.log(`action ${id}`, trace.status, computeHops(trace))
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
