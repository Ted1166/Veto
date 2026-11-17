import { createContext } from './clients.js'
import { statusName, triggerName } from './abi.js'
import {
    buyRisk,
    prime,
    restorePrice,
    sellRisk,
    topUpVault,
    ensureFunds
} from './lib/bot.js'
import {
    readAction,
    readGuardState,
    readPool,
    readReactiveState,
    readTokenBalance,
    readVault
} from './lib/chain.js'
import { computeHops } from './lib/latency.js'
import { ONE, formatPrice, formatTokens, parseTokens } from './lib/market.js'
import { traceAction } from './lib/trace.js'
import { appendTrace } from './lib/store.js'

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
        const [risk, stable] = await Promise.all([
            readTokenBalance(ctx, ctx.deployment.riskToken, ctx.account.address),
            readTokenBalance(ctx, ctx.deployment.stableToken, ctx.account.address)
        ])
        console.log('wallet risk / stable  ', formatTokens(risk, 2), '/', formatTokens(stable, 2))
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
        default:
            console.log('bot commands: funds | prime | sell <risk> | buy <stable> | restore [price] | topup [risk]')
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

const [command = 'help', ...rest] = process.argv.slice(2)

const commands: Record<string, () => Promise<void>> = {
    status,
    bot: () => bot(rest),
    trace: () => trace(rest)
}

const run = commands[command]
if (!run) {
    console.log('commands: status | bot <...> | trace <actionId> [scenario]')
    process.exit(command === 'help' ? 0 : 1)
}

run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
