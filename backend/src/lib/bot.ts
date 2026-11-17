import { type Context, requireWallet } from '../clients.js'
import {
    approvePool,
    mintTo,
    readPool,
    readTokenBalance,
    readVault,
    swapExact
} from './chain.js'
import type { TxPoint } from './latency.js'
import { BPS, ONE, riskToSellForPrice, scaleBps, stableToBuyForPrice } from './market.js'

export async function ensureFunds(ctx: Context): Promise<void> {
    const { account } = requireWallet(ctx)
    const { riskToken, stableToken } = ctx.deployment

    const risk = await readTokenBalance(ctx, riskToken, account.address)
    if (risk < 500n * ONE) await mintTo(ctx, riskToken, account.address, 1_000n * ONE)

    const stable = await readTokenBalance(ctx, stableToken, account.address)
    if (stable < 1_000_000n * ONE) {
        await mintTo(ctx, stableToken, account.address, 5_000_000n * ONE)
    }

    await approvePool(ctx, riskToken)
    await approvePool(ctx, stableToken)
}

export async function topUpVault(ctx: Context, targetRisk: bigint): Promise<bigint> {
    const { risk } = await readVault(ctx)
    if (risk >= targetRisk) return 0n
    const missing = targetRisk - risk
    await mintTo(ctx, ctx.deployment.riskToken, ctx.deployment.vault, missing)
    return missing
}

export async function sellRisk(ctx: Context, amount: bigint): Promise<TxPoint> {
    return swapExact(ctx, ctx.deployment.riskToken, amount)
}

export async function buyRisk(ctx: Context, stableAmount: bigint): Promise<TxPoint> {
    return swapExact(ctx, ctx.deployment.stableToken, stableAmount)
}

export async function restorePrice(
    ctx: Context,
    targetPrice: bigint,
    toleranceBps = 50n
): Promise<{ moved: 'none' | 'buy' | 'sell'; amount: bigint }> {
    const { reserves, price } = await readPool(ctx)
    const lower = scaleBps(targetPrice, BPS - toleranceBps)
    const upper = scaleBps(targetPrice, BPS + toleranceBps)

    if (price < lower) {
        const amount = stableToBuyForPrice(reserves, targetPrice)
        await buyRisk(ctx, amount)
        return { moved: 'buy', amount }
    }
    if (price > upper) {
        const amount = riskToSellForPrice(reserves, targetPrice)
        await sellRisk(ctx, amount)
        return { moved: 'sell', amount }
    }
    return { moved: 'none', amount: 0n }
}

export async function prime(ctx: Context): Promise<TxPoint> {
    return buyRisk(ctx, 100n * ONE)
}
