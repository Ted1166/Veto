import { createContext } from '../src/clients.js'
import { sleep } from '../src/lib/chain.js'
import { computeHops, toMarkdown } from '../src/lib/latency.js'
import { formatTokens } from '../src/lib/market.js'
import {
    DEFAULT_SCENARIOS,
    SCENARIOS,
    type ScenarioKind,
    runScenario
} from '../src/lib/scenario.js'
import { appendTrace, markdownPath, readTraces } from '../src/lib/store.js'

function parseArgs(argv: string[]) {
    const onlyIndex = argv.indexOf('--only')
    const only = onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? '') : ''
    const kinds = only
        ? only.split(',').map((value) => value.trim())
        : [...DEFAULT_SCENARIOS]

    for (const kind of kinds) {
        if (!(SCENARIOS as readonly string[]).includes(kind)) {
            throw new Error(`unknown scenario ${kind}. choose from ${SCENARIOS.join(', ')}`)
        }
    }
    return { kinds: kinds as ScenarioKind[], skipPause: argv.includes('--yes') }
}

async function main() {
    const { kinds, skipPause } = parseArgs(process.argv.slice(2))
    const ctx = createContext()

    const balance = await ctx.reactive.getBalance({ address: ctx.deployment.reactive })
    console.log(`scenarios: ${kinds.join(', ')}`)
    console.log(`reactive contract balance: ${formatTokens(balance, 4)}`)
    console.log(`rough budget: 0.15 to 0.25 per scenario at current Lasna gas prices`)

    if (!skipPause) {
        console.log('starting in 8 seconds, press Ctrl+C to cancel')
        await sleep(8_000)
    }

    for (const kind of kinds) {
        console.log(`\n=== ${kind}`)
        const result = await runScenario(ctx, kind)
        appendTrace(result.trace)
        console.log('hops', computeHops(result.trace))
        console.log(`reactive contract spent ${formatTokens(result.reactiveSpent, 4)}`)
    }

    console.log(`\n${toMarkdown(readTraces())}`)
    console.log(`\nsaved to ${markdownPath()}`)
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
