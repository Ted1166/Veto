import { describe, expect, it } from 'vitest'
import { legacyGasPrice, maxFundable } from '../src/lib/fees.js'
import { COST_ESTIMATE, shortfall } from '../src/lib/scenario.js'

describe('legacy gas price', () => {
    it('adds a quarter of headroom to the network price', () => {
        expect(legacyGasPrice(100_000_000_000n)).toBe(125_000_000_000n)
        expect(legacyGasPrice(200_000_000_000n)).toBe(250_000_000_000n)
    })

    it('never returns zero, which Lasna rejects as a zero tip', () => {
        expect(legacyGasPrice(0n)).toBe(1n)
        expect(legacyGasPrice(1n)).toBe(1n)
    })

    it('accepts a custom headroom', () => {
        expect(legacyGasPrice(1_000n, 10_000n)).toBe(1_000n)
        expect(legacyGasPrice(1_000n, 15_000n)).toBe(1_500n)
    })
})

describe('scenario funding estimate', () => {
    it('needs nothing when the contract holds enough', () => {
        expect(shortfall(10n ** 18n, ['approve', 'veto', 'timeout', 'recover'])).toBe(0n)
    })

    it('reports how much is missing for a full run', () => {
        const total = COST_ESTIMATE.approve * 3n + COST_ESTIMATE.timeout
        expect(shortfall(0n, ['approve', 'veto', 'timeout', 'recover'])).toBe(total)
        expect(shortfall(total - 1n, ['approve', 'veto', 'timeout', 'recover'])).toBe(1n)
    })

    it('flags the live situation: 0.009 cannot run even one scenario', () => {
        expect(shortfall(9_000_000_000_000_000n, ['approve'])).toBeGreaterThan(0n)
        expect(shortfall(9_000_000_000_000_000n, ['timeout'])).toBeGreaterThan(0n)
    })
})

describe('max fundable', () => {
    it('keeps a fee reserve out of the transfer', () => {
        expect(maxFundable(66_100_000_000_000_000n)).toBe(56_100_000_000_000_000n)
    })

    it('returns zero when the balance cannot even cover fees', () => {
        expect(maxFundable(5_000_000_000_000_000n)).toBe(0n)
        expect(maxFundable(0n)).toBe(0n)
    })
})
