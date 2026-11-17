import { type Address, maxUint256 } from 'viem'
import { guardAbi, poolAbi, reactiveAbi, tokenAbi, vaultAbi } from '../abi.js'
import { type Context, requireWallet } from '../clients.js'
import type { TxPoint } from './latency.js'
import { type Reserves, priceOf } from './market.js'

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitUntil<T>(
    label: string,
    probe: () => Promise<T | undefined | false>,
    options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 90_000
    const intervalMs = options.intervalMs ?? 1_000
    const deadline = Date.now() + timeoutMs
    for (; ;) {
        const result = await probe()
        if (result !== undefined && result !== false) return result
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
        await sleep(intervalMs)
    }
}

export async function readPool(ctx: Context): Promise<{ reserves: Reserves; price: bigint }> {
    const [risk, stable] = await ctx.origin.readContract({
        address: ctx.deployment.pool,
        abi: poolAbi,
        functionName: 'getReserves'
    })
    const reserves = { risk: BigInt(risk), stable: BigInt(stable) }
    return { reserves, price: priceOf(reserves) }
}

export async function readReactiveState(ctx: Context) {
    const address = ctx.deployment.reactive
    const read = <N extends 'lastPrice' | 'pendingActive' | 'pendingId' | 'cooldownUntil' | 'stopDisarmed' | 'tickActive'>(
        functionName: N
    ) => ctx.reactive.readContract({ address, abi: reactiveAbi, functionName })
    const [lastPrice, pendingActive, pendingId, cooldownUntil, stopDisarmed, tickActive] =
        await Promise.all([
            read('lastPrice'),
            read('pendingActive'),
            read('pendingId'),
            read('cooldownUntil'),
            read('stopDisarmed'),
            read('tickActive')
        ])
    return {
        lastPrice,
        pendingActive,
        pendingId: Number(pendingId),
        cooldownUntil: Number(cooldownUntil),
        stopDisarmed,
        tickActive
    }
}

export async function readGuardState(ctx: Context) {
    const address = ctx.deployment.guard
    const [actionCount, activeActionId] = await Promise.all([
        ctx.origin.readContract({ address, abi: guardAbi, functionName: 'actionCount' }),
        ctx.origin.readContract({ address, abi: guardAbi, functionName: 'activeActionId' })
    ])
    return { actionCount: Number(actionCount), activeActionId: Number(activeActionId) }
}

export async function readAction(ctx: Context, id: number) {
    return ctx.origin.readContract({
        address: ctx.deployment.guard,
        abi: guardAbi,
        functionName: 'getAction',
        args: [BigInt(id)]
    })
}

export async function readTokenBalance(ctx: Context, token: Address, holder: Address): Promise<bigint> {
    return ctx.origin.readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [holder]
    })
}

export async function readVault(ctx: Context) {
    const address = ctx.deployment.vault
    const [risk, stable] = await Promise.all([
        ctx.origin.readContract({ address, abi: vaultAbi, functionName: 'riskBalance' }),
        ctx.origin.readContract({ address, abi: vaultAbi, functionName: 'stableBalance' })
    ])
    return { risk, stable }
}

export async function latestTimestamp(client: Context['origin'] | Context['reactive']): Promise<number> {
    const block = await client.getBlock({ blockTag: 'latest' })
    return Number(block.timestamp)
}

async function settle(ctx: Context, hash: `0x${string}`): Promise<TxPoint> {
    const receipt = await ctx.origin.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`)
    const block = await ctx.origin.getBlock({ blockNumber: receipt.blockNumber })
    return { hash, block: Number(receipt.blockNumber), timestamp: Number(block.timestamp) }
}

export async function swapExact(ctx: Context, tokenIn: Address, amountIn: bigint): Promise<TxPoint> {
    const { wallet, account } = requireWallet(ctx)
    const hash = await wallet.writeContract({
        address: ctx.deployment.pool,
        abi: poolAbi,
        functionName: 'swap',
        args: [tokenIn, amountIn, 0n, account.address]
    })
    return settle(ctx, hash)
}

export async function mintTo(ctx: Context, token: Address, to: Address, amount: bigint): Promise<TxPoint> {
    const { wallet } = requireWallet(ctx)
    const hash = await wallet.writeContract({
        address: token,
        abi: tokenAbi,
        functionName: 'mint',
        args: [to, amount]
    })
    return settle(ctx, hash)
}

export async function approvePool(ctx: Context, token: Address): Promise<void> {
    const { wallet, account } = requireWallet(ctx)
    const allowance = await ctx.origin.readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'allowance',
        args: [account.address, ctx.deployment.pool]
    })
    if (allowance > maxUint256 / 2n) return
    const hash = await wallet.writeContract({
        address: token,
        abi: tokenAbi,
        functionName: 'approve',
        args: [ctx.deployment.pool, maxUint256]
    })
    await settle(ctx, hash)
}

export async function approveAction(ctx: Context, id: number): Promise<TxPoint> {
    const { wallet } = requireWallet(ctx)
    const hash = await wallet.writeContract({
        address: ctx.deployment.guard,
        abi: guardAbi,
        functionName: 'approve',
        args: [BigInt(id)]
    })
    return settle(ctx, hash)
}

export async function resizeAction(ctx: Context, id: number, bps: number): Promise<TxPoint> {
    const { wallet } = requireWallet(ctx)
    const hash = await wallet.writeContract({
        address: ctx.deployment.guard,
        abi: guardAbi,
        functionName: 'resize',
        args: [BigInt(id), bps]
    })
    return settle(ctx, hash)
}

export async function vetoAction(ctx: Context, id: number): Promise<TxPoint> {
    const { wallet } = requireWallet(ctx)
    const hash = await wallet.writeContract({
        address: ctx.deployment.guard,
        abi: guardAbi,
        functionName: 'veto',
        args: [BigInt(id)]
    })
    return settle(ctx, hash)
}

export async function executeDefaultAction(ctx: Context, id: number): Promise<TxPoint> {
    const { wallet } = requireWallet(ctx)
    const hash = await wallet.writeContract({
        address: ctx.deployment.guard,
        abi: guardAbi,
        functionName: 'executeDefault',
        args: [BigInt(id)]
    })
    return settle(ctx, hash)
}
