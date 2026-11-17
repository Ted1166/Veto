import { STATUS_PENDING } from '../abi.js'
import type { Context } from '../clients.js'
import { ensureFunds, buyRisk, restorePrice, sellRisk, topUpVault } from './bot.js'
import {
    approveAction,
    latestTimestamp,
    readAction,
    readGuardState,
    readPool,
    readReactiveState,
    resizeAction,
    sleep,
    vetoAction,
    waitUntil
} from './chain.js'
import type { Trace, TxPoint } from './latency.js'
import { BPS, ONE, formatPrice, riskToSellForPrice, scaleBps, stableToBuyForPrice } from './market.js'
import { traceAction } from './trace.js'

export const SCENARIOS = ['approve', 'resize', 'veto', 'timeout', 'recover', 'escalate'] as const
export type ScenarioKind = (typeof SCENARIOS)[number]

export const DEFAULT_SCENARIOS: ScenarioKind[] = ['approve', 'veto', 'timeout', 'recover']

export interface ScenarioResult {
    trace: Trace
    reactiveSpent: bigint
}

type Log = (message: string) => void

const demoPrice = () => BigInt(process.env.DEMO_PRICE ?? '2040') * ONE
const positionTarget = () => BigInt(process.env.DEMO_POSITION ?? '10') * ONE

export async function prepare(ctx: Context, log: Log): Promise<void> {
    await ensureFunds(ctx)
    const added = await topUpVault(ctx, positionTarget())
    if (added > 0n) log(`vault topped up with ${formatPrice(added, 2)} risk tokens`)

    const restored = await restorePrice(ctx, demoPrice())
    if (restored.moved !== 'none') {
        log(`pool price restored with a ${restored.moved} of ${formatPrice(restored.amount, 2)}`)
    }

    await waitUntil('the reactive contract to observe the pool price', async () => {
        const [state, pool] = await Promise.all([readReactiveState(ctx), readPool(ctx)])
        return state.lastPrice === pool.price ? true : undefined
    })
    await waitUntil('the stop trigger to re-arm', async () => {
        const state = await readReactiveState(ctx)
        return state.stopDisarmed ? undefined : true
    })
    await waitUntil('no pending action', async () => {
        const [state, guard] = await Promise.all([readReactiveState(ctx), readGuardState(ctx)])
        return !state.pendingActive && guard.activeActionId === 0 ? true : undefined
    })
    const [state, now] = await Promise.all([readReactiveState(ctx), latestTimestamp(ctx.reactive)])
    const remaining = state.cooldownUntil - now
    if (remaining > 0) {
        log(`waiting ${remaining + 1}s for the cooldown`)
        await sleep((remaining + 1) * 1_000)
    }
}

async function decide(
    ctx: Context,
    kind: ScenarioKind,
    id: number,
    log: Log
): Promise<(TxPoint & { kind: string }) | undefined> {
    switch (kind) {
        case 'approve': {
            const point = await approveAction(ctx, id)
            log(`approved ${point.hash}`)
            return { ...point, kind: 'approve' }
        }
        case 'resize': {
            const point = await resizeAction(ctx, id, 2_500)
            log(`resized to 25 percent ${point.hash}`)
            return { ...point, kind: 'resize' }
        }
        case 'veto': {
            const point = await vetoAction(ctx, id)
            log(`vetoed ${point.hash}`)
            return { ...point, kind: 'veto' }
        }
        case 'recover': {
            const action = await readAction(ctx, id)
            const { reserves } = await readPool(ctx)
            const target = scaleBps(
                action.triggerPrice,
                BPS + BigInt(ctx.settings.recoverBps) + 200n
            )
            const amount = stableToBuyForPrice(reserves, target)
            const point = await buyRisk(ctx, amount)
            log(`price pushed back up with a buy of ${formatPrice(amount, 0)} stable ${point.hash}`)
            return { ...point, kind: 'recovery buy' }
        }
        case 'escalate': {
            const action = await readAction(ctx, id)
            const { reserves } = await readPool(ctx)
            const target = scaleBps(
                action.triggerPrice,
                BPS - BigInt(ctx.settings.escalateBps) - 200n
            )
            const amount = riskToSellForPrice(reserves, target)
            const point = await sellRisk(ctx, amount)
            log(`price pushed further down with a sell of ${formatPrice(amount, 2)} risk ${point.hash}`)
            return { ...point, kind: 'second drop' }
        }
        case 'timeout':
            log('no decision, waiting for the default')
            return undefined
    }
}

export async function runScenario(
    ctx: Context,
    kind: ScenarioKind,
    log: Log = console.log
): Promise<ScenarioResult> {
    log(`scenario ${kind}: preparing`)
    await prepare(ctx, log)

    const reactiveBefore = await ctx.reactive.getBalance({ address: ctx.deployment.reactive })
    const before = await readGuardState(ctx)

    const { reserves, price } = await readPool(ctx)
    const target = scaleBps(price, BPS - BigInt(ctx.settings.gapBps + 250))
    const sellAmount = riskToSellForPrice(reserves, target)
    const origin = await sellRisk(ctx, sellAmount)
    log(
        `price ${formatPrice(price)}, selling ${formatPrice(sellAmount, 2)} risk to force a gap ${origin.hash}`
    )

    await waitUntil(
        'the guard to open an action',
        async () => {
            const state = await readGuardState(ctx)
            return state.actionCount > before.actionCount ? state.actionCount : undefined
        },
        { timeoutMs: 120_000 }
    )
    const id = (await readGuardState(ctx)).actionCount
    const opened = await readAction(ctx, id)
    log(`action ${id} opened ${opened.openedAt - BigInt(origin.timestamp)}s after the swap block`)

    const decision = await decide(ctx, kind, id, log)

    await waitUntil(
        `action ${id} to resolve`,
        async () => {
            const action = await readAction(ctx, id)
            return action.status === STATUS_PENDING ? undefined : action
        },
        { timeoutMs: (ctx.deployment.decisionWindow + 180) * 1000 }
    )

    const trace = await traceAction(ctx, id, { scenario: kind, decision })
    const reactiveAfter = await ctx.reactive.getBalance({ address: ctx.deployment.reactive })
    log(`action ${id} ended as ${trace.status}`)

    return { trace, reactiveSpent: reactiveBefore - reactiveAfter }
}
