import { describe, expect, it } from 'vitest'
import {
    ONE,
    afterBuyingRisk,
    afterSellingRisk,
    amountOut,
    dropBps,
    formatPrice,
    parseTokens,
    priceOf,
    riskToSellForPrice,
    stableToBuyForPrice
} from '../src/lib/market.js'

const seeded = { risk: 1_000n * ONE, stable: 2_000_000n * ONE }

describe('market math', () => {
    it('prices the seeded pool at 2000', () => {
        expect(priceOf(seeded)).toBe(2_000n * ONE)
        expect(formatPrice(priceOf(seeded))).toBe('2000.00')
    })

    it('matches the pool output observed on Base Sepolia for a 40 token sell', () => {
        const before = { risk: 0x36351895b8d81260dcn, stable: 0x01a789a364f808a5100000n }
        const after = afterSellingRisk(before, 40n * ONE)
        expect(after.risk).toBe(0x38603521caffb260dcn)
        expect(after.stable).toBe(0x01974b40bfdb1d6db22114n)
        expect(formatPrice(priceOf(before))).toBe('2000.19')
        expect(formatPrice(priceOf(after))).toBe('1849.50')
    })

    it('reproduces the 7.5 percent drop that triggered the first live action', () => {
        const before = { risk: 0x36351895b8d81260dcn, stable: 0x01a789a364f808a5100000n }
        const after = afterSellingRisk(before, 40n * ONE)
        const drop = dropBps(priceOf(before), priceOf(after))
        expect(drop).toBeGreaterThan(740)
        expect(drop).toBeLessThan(760)
    })

    it('computes buy output with the 0.3 percent fee', () => {
        expect(amountOut(1_000n, 1_000_000n, 1_000_000n)).toBe(996n)
    })

    it('finds the smallest sell that reaches a lower price', () => {
        const target = 1_850n * ONE
        const amount = riskToSellForPrice(seeded, target)
        expect(priceOf(afterSellingRisk(seeded, amount))).toBeLessThanOrEqual(target)
        expect(priceOf(afterSellingRisk(seeded, amount - 1n))).toBeGreaterThan(target)
    })

    it('finds the smallest buy that reaches a higher price', () => {
        const target = 2_100n * ONE
        const amount = stableToBuyForPrice(seeded, target)
        expect(priceOf(afterBuyingRisk(seeded, amount))).toBeGreaterThanOrEqual(target)
        expect(priceOf(afterBuyingRisk(seeded, amount - 1n))).toBeLessThan(target)
    })

    it('returns zero when the pool is already past the target', () => {
        expect(riskToSellForPrice(seeded, 2_500n * ONE)).toBe(0n)
        expect(stableToBuyForPrice(seeded, 1_500n * ONE)).toBe(0n)
    })

    it('parses and formats token amounts', () => {
        expect(parseTokens('40')).toBe(40n * ONE)
        expect(parseTokens('0.5')).toBe(ONE / 2n)
        expect(formatPrice(parseTokens('12.345'), 3)).toBe('12.345')
    })
})
