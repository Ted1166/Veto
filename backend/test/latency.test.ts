import { describe, expect, it } from 'vitest'
import { type Trace, computeHops, summarize, toMarkdown } from '../src/lib/latency.js'

const base: Trace = {
    actionId: 1,
    scenario: 'timeout',
    trigger: 'PriceGap',
    status: 'Defaulted',
    executedBps: 5000,
    triggerPrice: '1849503387663633500384',
    decisionWindow: 60,
    openedAt: 1_794_833_675,
    deadline: 1_794_833_735,
    resolvedAt: 1_794_833_742,
    origin: { hash: '0x7b1beaa8a010db89629cbefc2995a7c0173cb5e6fac6215b22a9693491af0675', block: 59559024, timestamp: 1_794_833_673 },
    reactive: { hash: '0x1111111111111111111111111111111111111111111111111111111111111111', block: 8490000, timestamp: 1_794_833_674 },
    callback: { hash: '0x2222222222222222222222222222222222222222222222222222222222222222', block: 59559034, timestamp: 1_794_833_675 },
    recordedAt: '2026-11-16T00:00:00.000Z'
}

describe('latency', () => {
    it('derives the hops from the live measurements', () => {
        const hops = computeHops(base)
        expect(hops.originToReactive).toBe(1)
        expect(hops.reactiveToCallback).toBe(1)
        expect(hops.endToEnd).toBe(2)
        expect(hops.windowLeft).toBe(58)
        expect(hops.windowLeftShare).toBeCloseTo(58 / 60)
        expect(hops.deadlineToResolved).toBe(7)
    })

    it('leaves reactive hops empty when the reactive transaction was not found', () => {
        const hops = computeHops({ ...base, reactive: undefined })
        expect(hops.originToReactive).toBeUndefined()
        expect(hops.reactiveToCallback).toBeUndefined()
        expect(hops.endToEnd).toBe(2)
    })

    it('only reports deadline lag for defaulted actions', () => {
        expect(computeHops({ ...base, status: 'Approved' }).deadlineToResolved).toBeUndefined()
    })

    it('measures the decision delay when the owner acts', () => {
        const hops = computeHops({
            ...base,
            status: 'Approved',
            decision: { kind: 'approve', hash: '0xabc', block: 1, timestamp: 1_794_833_690 }
        })
        expect(hops.decisionAfterOpen).toBe(15)
    })

    it('summarizes samples', () => {
        expect(summarize([])).toBeUndefined()
        expect(summarize([2, 4, 6])).toEqual({ count: 3, min: 2, max: 6, mean: 4 })
    })

    it('renders a markdown table with transaction hashes', () => {
        const markdown = toMarkdown([base])
        expect(markdown).toContain('| timeout | 1 | PriceGap | Defaulted | 1s | 1s | 2s | 58s | 7s |')
        expect(markdown).toContain('0x7b1beaa8...693491af0675'.slice(0, 11))
        expect(markdown).toContain('End to end over 1 actions')
        expect(markdown).toContain('Default requested')
    })
})
