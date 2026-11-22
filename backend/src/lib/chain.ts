import { type Address, maxUint256, parseAbi } from 'viem'
import { guardAbi, poolAbi, reactiveAbi, tokenAbi, vaultAbi } from '../abi.js'
import { type Context, requireReactiveWallet, requireWallet } from '../clients.js'
import { legacyGasPrice, maxFundable } from './fees.js'
import { formatPrice } from './market.js'
import type { TxPoint } from './latency.js'
import { type Reserves, priceOf } from './market.js'

export { sleep, waitUntil } from './wait.js'

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

export async function fundReactiveContract(ctx: Context, value: bigint): Promise<`0x${string}`> {
    const { wallet, account } = requireReactiveWallet(ctx)
    const balance = await ctx.reactive.getBalance({ address: account.address })
    const fundable = maxFundable(balance)
    if (value > fundable) {
        throw new Error(
            `Your wallet holds ${formatPrice(balance, 4)} on the reactive chain and needs about 0.01 of that for fees. The most you can send now is ${formatPrice(fundable, 2)}: npm run bot -- fund-reactive ${formatPrice(fundable, 2)}`
        )
    }
    const gasPrice = legacyGasPrice(await ctx.reactive.getGasPrice())
    const hash = await wallet.sendTransaction({
        to: ctx.deployment.reactive,
        value,
        type: 'legacy',
        gasPrice
    })
    const receipt = await ctx.reactive.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`funding transaction ${hash} reverted`)
    return hash
}

export async function fundGuard(ctx: Context, value: bigint): Promise<`0x${string}`> {
    const { wallet } = requireWallet(ctx)
    const hash = await wallet.sendTransaction({ to: ctx.deployment.guard, value })
    const receipt = await ctx.origin.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`funding transaction ${hash} reverted`)
    return hash
}

const SYSTEM_CONTRACT: Address = '0x8888888888888888888888888888888888888888'
const debtAbi = parseAbi(['function debt(address account) view returns (uint256)'])
const coverDebtAbi = parseAbi(['function coverDebt()'])

export async function readDebts(ctx: Context): Promise<{ reactive: bigint; guard: bigint }> {
    const [reactive, guard] = await Promise.all([
        ctx.reactive.readContract({
            address: SYSTEM_CONTRACT,
            abi: debtAbi,
            functionName: 'debt',
            args: [ctx.deployment.reactive]
        }),
        ctx.origin.readContract({
            address: ctx.deployment.callbackProxy,
            abi: debtAbi,
            functionName: 'debt',
            args: [ctx.deployment.guard]
        })
    ])
    return { reactive, guard }
}

export async function coverDebt(ctx: Context, which: 'reactive' | 'guard'): Promise<`0x${string}`> {
    if (which === 'guard') {
        const { wallet } = requireWallet(ctx)
        const hash = await wallet.writeContract({
            address: ctx.deployment.guard,
            abi: coverDebtAbi,
            functionName: 'coverDebt'
        })
        await ctx.origin.waitForTransactionReceipt({ hash })
        return hash
    }
    const { wallet } = requireReactiveWallet(ctx)
    const hash = await wallet.writeContract({
        address: ctx.deployment.reactive,
        abi: coverDebtAbi,
        functionName: 'coverDebt',
        type: 'legacy',
        gasPrice: legacyGasPrice(await ctx.reactive.getGasPrice())
    })
    await ctx.reactive.waitForTransactionReceipt({ hash })
    return hash
}
