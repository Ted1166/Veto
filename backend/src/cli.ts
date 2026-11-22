import { createContext } from './clients.js'
import { statusName, triggerName } from './abi.js'
import {
    buyRisk,
    prime,
    restorePrice,
    sellRisk,
    topUpVault
} from './lib/bot.js'
import {
    coverDebt,
    fundGuard,
    fundReactiveContract,
    readAction,
    readDebts,
    readGuardState,
    readPool,
    readReactiveState,
    readTokenBalance,
    readVault
} from './lib/chain.js'
import { computeHops, describeEndToEnd, latestPerScenario, toMarkdown } from './lib/latency.js'
import { ONE, formatPrice, formatTokens, parseTokens } from './lib/market.js'
import { traceAction } from './lib/trace.js'
import { appendTrace, readTraces, writeSubmission } from './lib/store.js'
import { ensureFunds } from './lib/bot.js'

async function status() {
    const ctx = createContext()
    const [pool, reactive, guard, vault] = await Promise.all([
        readPool(ctx),
        readReactiveState(ctx),
        readGuardState(ctx),
        readVault(ctx)
    ])
    const [reactiveBalance, guardBalance] = await Promise.all([
        ctx.reactive.getBalance({ address: ctx.deployment.reactive }),
        ctx.origin.getBalance({ address: ctx.deployment.guard })
    ])

    console.log('pool price            ', formatPrice(pool.price))
    console.log('reactive last price   ', formatPrice(reactive.lastPrice))
    console.log('reactive pending      ', reactive.pendingActive, reactive.pendingId || '')
    console.log('stop trigger disarmed ', reactive.stopDisarmed)
    console.log('ticks active          ', reactive.tickActive)
    console.log('cooldown until        ', reactive.cooldownUntil)
    console.log('guard actions         ', guard.actionCount, 'active', guard.activeActionId)
    console.log('vault risk / stable   ', formatTokens(vault.risk, 4), '/', formatTokens(vault.stable, 2))
    console.log('reactive contract bal ', formatTokens(reactiveBalance, 4))
    console.log('guard balance (eth)   ', formatTokens(guardBalance, 6))
    const debts = await readDebts(ctx)
    console.log('reactive debt         ', formatTokens(debts.reactive, 4))
    console.log('guard debt            ', formatTokens(debts.guard, 6))

    if (reactive.pendingActive && guard.activeActionId === 0) {
        console.log(
            '\nThe reactive contract still tracks a pending action that the guard has already closed.'
        )
        console.log(
            'It most likely cannot pay for reactions. Fund it (npm run bot -- fund-reactive <amount>) and, if it owes debt, run npm run bot -- cover-debt reactive. It clears itself on its next tick.\n'
        )
    } else if (debts.reactive > 0n) {
        console.log('\nThe reactive contract owes debt and receives nothing until it is covered: npm run bot -- cover-debt reactive\n')
    }

    if (guard.actionCount > 0) {
        const action = await readAction(ctx, guard.actionCount)
        console.log(
            `latest action ${guard.actionCount}`,
            triggerName(action.trigger),
            statusName(action.status),
            `executed ${action.executedBps} bps`
        )
    }
    if (ctx.account) {
        const [risk, stable, reactiveNative, originNative] = await Promise.all([
            readTokenBalance(ctx, ctx.deployment.riskToken, ctx.account.address),
            readTokenBalance(ctx, ctx.deployment.stableToken, ctx.account.address),
            ctx.reactive.getBalance({ address: ctx.account.address }),
            ctx.origin.getBalance({ address: ctx.account.address })
        ])
        console.log('wallet risk / stable  ', formatTokens(risk, 2), '/', formatTokens(stable, 2))
        console.log('wallet reactive chain ', formatTokens(reactiveNative, 4))
        console.log('wallet origin (eth)   ', formatTokens(originNative, 6))
    }
}

async function bot(args: string[]) {
    const ctx = createContext()
    const [command = 'help', value] = args
    switch (command) {
        case 'funds':
            await ensureFunds(ctx)
            console.log('wallet funded and pool approvals set')
            return
        case 'prime': {
            await ensureFunds(ctx)
            const point = await prime(ctx)
            console.log('primed', point.hash)
            return
        }
        case 'sell': {
            await ensureFunds(ctx)
            const point = await sellRisk(ctx, parseTokens(value ?? '1'))
            console.log('sold', point.hash)
            return
        }
        case 'buy': {
            await ensureFunds(ctx)
            const point = await buyRisk(ctx, parseTokens(value ?? '100'))
            console.log('bought', point.hash)
            return
        }
        case 'restore': {
            await ensureFunds(ctx)
            const target = BigInt(value ?? '2040') * ONE
            const result = await restorePrice(ctx, target)
            console.log('restore', result.moved, formatTokens(result.amount, 2))
            return
        }
        case 'topup': {
            const target = parseTokens(value ?? '10')
            const added = await topUpVault(ctx, target)
            console.log('vault topped up with', formatTokens(added, 2))
            return
        }
        case 'fund-reactive': {
            const amount = parseTokens(value ?? '')
            if (amount <= 0n) throw new Error('usage: bot fund-reactive <amount>, for example 0.3')
            const hash = await fundReactiveContract(ctx, amount)
            console.log('sent', formatTokens(amount, 4), 'to the reactive contract', hash)
            return
        }
        case 'fund-guard': {
            const amount = parseTokens(value ?? '')
            if (amount <= 0n) throw new Error('usage: bot fund-guard <amount>, for example 0.001')
            const hash = await fundGuard(ctx, amount)
            console.log('sent', formatTokens(amount, 6), 'to the guard', hash)
            return
        }
        case 'cover-debt': {
            if (value !== 'reactive' && value !== 'guard') throw new Error('usage: bot cover-debt reactive|guard')
            const hash = await coverDebt(ctx, value)
            console.log('debt covered', hash)
            return
        }
        default:
            console.log(
                'bot commands: funds | prime | sell <risk> | buy <stable> | restore [price] | topup [risk] | fund-reactive <amount> | fund-guard <amount> | cover-debt reactive|guard'
            )
    }
}

async function trace(args: string[]) {
    const ctx = createContext()
    const id = Number(args[0])
    if (!Number.isInteger(id) || id < 1) throw new Error('usage: trace <actionId> [scenario]')
    const result = await traceAction(ctx, id, { scenario: args[1] ?? 'live' })
    appendTrace(result)
    console.log(JSON.stringify(result, null, 2))
    console.log(computeHops(result))
}

async function report() {
    const all = readTraces()
    if (all.length === 0) throw new Error('no traces recorded yet, run the demo or trace first')
    const picked = latestPerScenario(all)
    const explorer = process.env.VITE_EXPLORER ?? 'https://sepolia.basescan.org'
    const parts = [toMarkdown(picked, undefined, explorer)]
    const overall = describeEndToEnd(all)
    if (overall && all.length !== picked.length) {
        parts.push(`All ${all.length} recorded actions. ${overall}`)
    }
    const markdown = parts.join('\n\n')
    const file = writeSubmission(markdown)
    console.log(markdown)
    console.log(`\nsaved to ${file}`)
}

const [command = 'help', ...rest] = process.argv.slice(2)

const commands: Record<string, () => Promise<void>> = {
    status,
    bot: () => bot(rest),
    trace: () => trace(rest),
    report
}

const run = commands[command]
if (!run) {
    console.log('commands: status | bot <...> | trace <actionId> [scenario] | report')
    process.exit(command === 'help' ? 0 : 1)
}

run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
