import { parseAbiItem } from 'viem'
import { statusName, triggerName } from '../abi.js'
import type { Context } from '../clients.js'
import { readAction } from './chain.js'
import type { Trace, TxPoint } from './latency.js'
import { priceOf } from './market.js'

const openedEvent = parseAbiItem(
    'event ActionOpened(uint256 indexed id, uint8 trigger, uint16 proposedBps, uint256 triggerPrice, uint64 deadline)'
)
const syncEvent = parseAbiItem('event Sync(uint112 reserve0, uint112 reserve1)')
const triggerEvent = parseAbiItem(
    'event TriggerFired(uint8 indexed trigger, uint256 price, uint256 previousPrice)'
)
const directiveEvent = parseAbiItem(
    'event DirectiveSent(uint8 indexed directive, uint256 indexed actionId, uint256 price)'
)

const CHUNK = 2_000n

async function pointFor(
    client: Context['origin'] | Context['reactive'],
    hash: `0x${string}`,
    blockNumber: bigint
): Promise<TxPoint> {
    const block = await client.getBlock({ blockNumber })
    return { hash, block: Number(blockNumber), timestamp: Number(block.timestamp) }
}

async function findOpened(ctx: Context, id: number, lookback: bigint) {
    const latest = await ctx.origin.getBlockNumber()
    const floor = latest > lookback ? latest - lookback : 0n
    for (let end = latest; end >= floor; end -= CHUNK) {
        const start = end - CHUNK + 1n > floor ? end - CHUNK + 1n : floor
        const logs = await ctx.origin.getLogs({
            address: ctx.deployment.guard,
            event: openedEvent,
            args: { id: BigInt(id) },
            fromBlock: start,
            toBlock: end
        })
        const found = logs[0]
        if (found) return found
        if (start === floor) break
    }
    return undefined
}

async function findOrigin(ctx: Context, price: bigint, openedBlock: bigint): Promise<TxPoint | undefined> {
    const from = openedBlock > 600n ? openedBlock - 600n : 0n
    const logs = await ctx.origin.getLogs({
        address: ctx.deployment.pool,
        event: syncEvent,
        fromBlock: from,
        toBlock: openedBlock
    })
    for (const log of [...logs].reverse()) {
        const { reserve0, reserve1 } = log.args
        if (reserve0 === undefined || reserve1 === undefined) continue
        if (priceOf({ risk: reserve0, stable: reserve1 }) === price) {
            return pointFor(ctx.origin, log.transactionHash, log.blockNumber)
        }
    }
    return undefined
}

async function reactiveWindow(ctx: Context, aroundTimestamp: number, radius: bigint) {
    const latest = await ctx.reactive.getBlock({ blockTag: 'latest' })
    const behind = BigInt(Math.max(0, Number(latest.timestamp) - aroundTimestamp))
    const estimate = latest.number > behind ? latest.number - behind : 0n
    const from = estimate > radius ? estimate - radius : 0n
    const to = estimate + radius > latest.number ? latest.number : estimate + radius
    return { from, to }
}

async function findReactiveTrigger(
    ctx: Context,
    price: bigint,
    aroundTimestamp: number
): Promise<TxPoint | undefined> {
    for (const radius of [80n, 800n]) {
        const { from, to } = await reactiveWindow(ctx, aroundTimestamp, radius)
        const logs = await ctx.reactive.getLogs({
            address: ctx.deployment.reactive,
            event: triggerEvent,
            fromBlock: from,
            toBlock: to
        })
        const match = [...logs].reverse().find((log) => log.args.price === price)
        if (match) return pointFor(ctx.reactive, match.transactionHash, match.blockNumber)
    }
    return undefined
}

async function findDefaultDirective(
    ctx: Context,
    id: number,
    aroundTimestamp: number
): Promise<TxPoint | undefined> {
    for (const radius of [80n, 800n]) {
        const { from, to } = await reactiveWindow(ctx, aroundTimestamp, radius)
        const logs = await ctx.reactive.getLogs({
            address: ctx.deployment.reactive,
            event: directiveEvent,
            args: { directive: 2, actionId: BigInt(id) },
            fromBlock: from,
            toBlock: to
        })
        const first = logs[0]
        if (first) return pointFor(ctx.reactive, first.transactionHash, first.blockNumber)
    }
    return undefined
}

export interface TraceOptions {
    scenario?: string
    decision?: TxPoint & { kind: string }
    lookbackBlocks?: bigint
}

export async function traceAction(ctx: Context, id: number, options: TraceOptions = {}): Promise<Trace> {
    const action = await readAction(ctx, id)
    const opened = await findOpened(ctx, id, options.lookbackBlocks ?? 60_000n)

    const callback = opened
        ? await pointFor(ctx.origin, opened.transactionHash, opened.blockNumber)
        : undefined
    const origin = opened ? await findOrigin(ctx, action.triggerPrice, opened.blockNumber) : undefined
    const reactive = await findReactiveTrigger(ctx, action.triggerPrice, Number(action.openedAt))
    const status = statusName(action.status)
    const timeoutDirective =
        status === 'Defaulted'
            ? await findDefaultDirective(ctx, id, Number(action.resolvedAt))
            : undefined

    return {
        actionId: id,
        scenario: options.scenario ?? 'live',
        trigger: triggerName(action.trigger),
        status,
        executedBps: action.executedBps,
        triggerPrice: action.triggerPrice.toString(),
        decisionWindow: ctx.deployment.decisionWindow,
        openedAt: Number(action.openedAt),
        deadline: Number(action.deadline),
        resolvedAt: Number(action.resolvedAt),
        origin,
        reactive,
        callback,
        decision: options.decision,
        timeoutDirective,
        recordedAt: new Date().toISOString()
    }
}
