export const ONE = 10n ** 18n
export const BPS = 10_000n
const FEE_BPS = 30n

export interface Reserves {
    risk: bigint
    stable: bigint
}

export function priceOf(reserves: Reserves): bigint {
    return (reserves.stable * ONE) / reserves.risk
}

export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    const withFee = amountIn * (BPS - FEE_BPS)
    return (withFee * reserveOut) / (reserveIn * BPS + withFee)
}

export function afterSellingRisk(reserves: Reserves, riskIn: bigint): Reserves {
    const out = amountOut(riskIn, reserves.risk, reserves.stable)
    return { risk: reserves.risk + riskIn, stable: reserves.stable - out }
}

export function afterBuyingRisk(reserves: Reserves, stableIn: bigint): Reserves {
    const out = amountOut(stableIn, reserves.stable, reserves.risk)
    return { risk: reserves.risk - out, stable: reserves.stable + stableIn }
}

export function riskToSellForPrice(reserves: Reserves, targetPrice: bigint): bigint {
    if (priceOf(reserves) <= targetPrice) return 0n
    let low = 0n
    let high = reserves.risk * 1_000n
    while (high - low > 1n) {
        const mid = (low + high) / 2n
        if (priceOf(afterSellingRisk(reserves, mid)) > targetPrice) low = mid
        else high = mid
    }
    return high
}

export function stableToBuyForPrice(reserves: Reserves, targetPrice: bigint): bigint {
    if (priceOf(reserves) >= targetPrice) return 0n
    let low = 0n
    let high = reserves.stable * 1_000n
    while (high - low > 1n) {
        const mid = (low + high) / 2n
        if (priceOf(afterBuyingRisk(reserves, mid)) < targetPrice) low = mid
        else high = mid
    }
    return high
}

export function scaleBps(value: bigint, bps: bigint): bigint {
    return (value * bps) / BPS
}

export function dropBps(before: bigint, after: bigint): number {
    if (before === 0n) return 0
    return Number(((before - after) * BPS) / before)
}

export function formatPrice(price: bigint, digits = 2): string {
    const scale = 10n ** BigInt(digits)
    const scaled = (price * scale) / ONE
    const whole = scaled / scale
    const fraction = (scaled % scale).toString().padStart(digits, '0')
    return `${whole}.${fraction}`
}

export function formatTokens(amount: bigint, digits = 4): string {
    return formatPrice(amount, digits)
}

export function parseTokens(value: string): bigint {
    const [whole = '0', fraction = ''] = value.split('.')
    const padded = (fraction + '0'.repeat(18)).slice(0, 18)
    return BigInt(whole) * ONE + BigInt(padded || '0')
}
