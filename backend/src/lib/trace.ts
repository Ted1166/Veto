import { parseAbiItem } from 'viem'
import { statusName, triggerName } from '../abi.js'
import type { Context } from '../clients.js'
import {
    type BlockSource,
    chunkRanges,
    firstBlockAtOrAfter,
    lastBlockAtOrBefore,
    logRange,
    memoize
} from './blocks.js'
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

type Client = Context['origin'] | Context['reactive']

function sourceFor(client: Client): BlockSource {
    return memoize({
        async latest() {
            const block = await client.getBlock({ blockTag: 'latest' })
            return { number: block.number, timestamp: Number(block.timestamp) }
        },
        async at(number) {
            const block = await client.getBlock({ blockNumber: number })
            return { timestamp: Number(block.timestamp) }
        }
    })
}

async function pointFor(client: Client, hash: `0x${string}`, blockNumber: bigint): Promise<TxPoint> {
    const block = await client.getBlock({ blockNumber })
    return { hash, block: Number(blockNumber), timestamp: Number(block.timestamp) }
}

async function findOpened(ctx: Context, source: BlockSource, id: number, openedAt: number) {
    const from = await firstBlockAtOrAfter(source, openedAt - 1)
    const to = await lastBlockAtOrBefore(source, openedAt + 1)
    for (const [start, end] of chunkRanges(from, to, logRange())) {
        const logs = await ctx.origin.getLogs({
            address: ctx.deployment.guard,
            event: openedEvent,
            args: { id: BigInt(id) },
            fromBlock: start,
            toBlock: end
        })
        if (logs[0]) return logs[0]
    }
    return undefined
}

async function findOrigin(
    ctx: Context,
    source: BlockSource,
    price: bigint,
    openedBlock: bigint,
    openedAt: number
): Promise<TxPoint | undefined> {
    const from = await firstBlockAtOrAfter(source, openedAt - 90)
    for (const [start, end] of chunkRanges(from, openedBlock, logRange(), 'backward')) {
        const logs = await ctx.origin.getLogs({
            address: ctx.deployment.pool,
            event: syncEvent,
            fromBlock: start,
            toBlock: end
        })
        for (const log of [...logs].reverse()) {
            const { reserve0, reserve1 } = log.args
            if (reserve0 === undefined || reserve1 === undefined) continue
            if (priceOf({ risk: reserve0, stable: reserve1 }) === price) {
                return pointFor(ctx.origin, log.transactionHash, log.blockNumber)
            }
        }
    }
    return undefined
}

async function findReactiveTrigger(
    ctx: Context,
    source: BlockSource,
    price: bigint,
    fromTimestamp: number,
    toTimestamp: number
): Promise<TxPoint | undefined> {
    const from = await firstBlockAtOrAfter(source, fromTimestamp)
    const to = await lastBlockAtOrBefore(source, toTimestamp)
    for (const [start, end] of chunkRanges(from, to, logRange(), 'backward')) {
        const logs = await ctx.reactive.getLogs({
            address: ctx.deployment.reactive,
            event: triggerEvent,
            fromBlock: start,
            toBlock: end
        })
        const match = [...logs].reverse().find((log) => log.args.price === price)
        if (match) return pointFor(ctx.reactive, match.transactionHash, match.blockNumber)
    }
    return undefined
}

async function findDefaultDirective(
    ctx: Context,
    source: BlockSource,
    id: number,
    deadline: number,
    resolvedAt: number
): Promise<TxPoint | undefined> {
    const from = await firstBlockAtOrAfter(source, deadline - 2)
    const to = await lastBlockAtOrBefore(source, resolvedAt + 2)
    for (const [start, end] of chunkRanges(from, to, logRange())) {
        const logs = await ctx.reactive.getLogs({
            address: ctx.deployment.reactive,
            event: directiveEvent,
            args: { directive: 2, actionId: BigInt(id) },
            fromBlock: start,
            toBlock: end
        })
        const first = logs[0]
        if (first) return pointFor(ctx.reactive, first.transactionHash, first.blockNumber)
    }
    return undefined
}

export interface TraceOptions {
    scenario?: string
    decision?: TxPoint & { kind: string }
}

export async function traceAction(ctx: Context, id: number, options: TraceOptions = {}): Promise<Trace> {
    const action = await readAction(ctx, id)
    const originSource = sourceFor(ctx.origin)
    const reactiveSource = sourceFor(ctx.reactive)
    const openedAt = Number(action.openedAt)

    const opened = await findOpened(ctx, originSource, id, openedAt)
    const callback = opened
        ? await pointFor(ctx.origin, opened.transactionHash, opened.blockNumber)
        : undefined
    const origin = opened
        ? await findOrigin(ctx, originSource, action.triggerPrice, opened.blockNumber, openedAt)
        : undefined

    const reactive = await findReactiveTrigger(
        ctx,
        reactiveSource,
        action.triggerPrice,
        (origin?.timestamp ?? openedAt - 90) - 2,
        openedAt + 2
    )

    const status = statusName(action.status)
    const timeoutDirective =
        status === 'Defaulted'
            ? await findDefaultDirective(
                ctx,
                reactiveSource,
                id,
                Number(action.deadline),
                Number(action.resolvedAt)
            )
            : undefined

    return {
        actionId: id,
        scenario: options.scenario ?? 'live',
        trigger: triggerName(action.trigger),
        status,
        executedBps: action.executedBps,
        triggerPrice: action.triggerPrice.toString(),
        decisionWindow: ctx.deployment.decisionWindow,
        openedAt,
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
