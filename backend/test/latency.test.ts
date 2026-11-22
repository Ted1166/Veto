import { describe, expect, it } from 'vitest'
import {
    type Trace,
    computeHops,
    describeEndToEnd,
    latestPerScenario,
    summarize,
    toMarkdown
} from '../src/lib/latency.js'

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
        expect(markdown).toContain('| timeout | 1 | PriceGap | Defaulted | 1s | 1s | 2s (10 blocks, ~2.0s) | 58s | 7s |')
        expect(markdown).toContain('0x7b1beaa8...693491af0675'.slice(0, 11))
        expect(markdown).toContain('End to end over 1 actions')
        expect(markdown).toContain('Default requested')
    })

    it('counts origin blocks between the swap and the action', () => {
        const hops = computeHops(base)
        expect(hops.endToEndBlocks).toBe(10)
        expect(hops.endToEndEstimateMs).toBe(2000)
        expect(computeHops(base, 250).endToEndEstimateMs).toBe(2500)
    })
})

describe('live Base Sepolia and Lasna measurement', () => {
    const live: Trace = {
        actionId: 1,
        scenario: 'timeout',
        trigger: 'PriceGap',
        status: 'Defaulted',
        executedBps: 5000,
        triggerPrice: '1886999999999999999999',
        decisionWindow: 60,
        openedAt: 1_794_914_585,
        deadline: 1_794_914_645,
        resolvedAt: 1_794_914_649,
        origin: { hash: '0x8976b699c61cba18d7e98846c3137628c939198ede9654bea14972225251ddc8', block: 59963578, timestamp: 1_794_914_584 },
        reactive: { hash: '0xcb68d6694219ad15966b70bca1fe1559adc2635f7da32eeb96759ed2ef7128c8', block: 8566770, timestamp: 1_794_914_583 },
        callback: { hash: '0x295e5af103a9f19cb39e941dc23e2bfe34b074b9f08f670eea0cfa5ed846d9fb', block: 59963584, timestamp: 1_794_914_585 },
        timeoutDirective: { hash: '0xa898801f1365e100317a37906d78d607472d88ee7b5528f65f28bf9495580531', block: 8566831, timestamp: 1_794_914_648 },
        recordedAt: '2026-11-17T11:50:45.545Z'
    }

    it('never reports a negative hop when the reactive clock runs behind', () => {
        const hops = computeHops(live)
        expect(hops.clockSkew).toBe(1)
        expect(hops.originToReactive).toBe(0)
        expect(hops.reactiveToCallback).toBe(1)
        expect(hops.originToReactive! + hops.reactiveToCallback!).toBe(hops.endToEnd)
    })

    it('reports one second and six blocks from swap to action', () => {
        const hops = computeHops(live)
        expect(hops.endToEnd).toBe(1)
        expect(hops.endToEndBlocks).toBe(6)
        expect(hops.endToEndEstimateMs).toBe(1200)
        expect(hops.windowLeft).toBe(59)
        expect(hops.deadlineToResolved).toBe(4)
    })

    it('explains the clock difference in the markdown', () => {
        const markdown = toMarkdown([live])
        expect(markdown).toContain('| timeout | 1 | PriceGap | Defaulted | 0s | 1s | 1s (6 blocks, ~1.2s) | 59s | 4s |')
        expect(markdown).toContain('different clocks')
        expect(markdown).not.toContain('-1s')
    })
})

describe('report selection', () => {
    const make = (actionId: number, scenario: string, openedAt: number): Trace => ({
        ...base,
        actionId,
        scenario,
        openedAt,
        origin: base.origin ? { ...base.origin, timestamp: openedAt - 1 } : undefined
    })

    it('keeps the newest trace for each scenario in a stable order', () => {
        const picked = latestPerScenario([
            make(1, 'timeout', 100),
            make(2, 'approve', 200),
            make(3, 'veto', 300),
            make(4, 'approve', 400),
            make(5, 'veto', 500),
            make(6, 'timeout', 600),
            make(7, 'recover', 700)
        ])
        expect(picked.map((trace) => [trace.scenario, trace.actionId])).toEqual([
            ['approve', 4],
            ['veto', 5],
            ['timeout', 6],
            ['recover', 7]
        ])
    })

    it('places unknown scenarios last', () => {
        const picked = latestPerScenario([make(1, 'live', 100), make(2, 'approve', 200)])
        expect(picked.map((trace) => trace.scenario)).toEqual(['approve', 'live'])
    })

    it('describes end to end latency across all given traces', () => {
        const text = describeEndToEnd([make(1, 'approve', 100), make(2, 'veto', 200)])
        expect(text).toContain('End to end over 2 actions')
        expect(describeEndToEnd([])).toBeUndefined()
    })
})

describe('markdown with explorer links', () => {
    const explorer = 'https://sepolia.basescan.org'

    it('links origin chain transactions and prints reactive hashes in full', () => {
        const markdown = toMarkdown([base], 200, explorer)
        expect(markdown).toContain(`](${explorer}/tx/${base.origin?.hash})`)
        expect(markdown).toContain(`](${explorer}/tx/${base.callback?.hash})`)
        expect(markdown).toContain(`\`${base.reactive?.hash}\``)
    })

    it('keeps the short plain form without an explorer', () => {
        expect(toMarkdown([base])).not.toContain('https://')
    })
})
