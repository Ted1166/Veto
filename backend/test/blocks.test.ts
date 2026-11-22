import { describe, expect, it } from 'vitest'
import {
    type BlockSource,
    chunkRanges,
    firstBlockAtOrAfter,
    lastBlockAtOrBefore,
    memoize
} from '../src/lib/blocks.js'

function chain(latest: bigint, timestampOf: (n: bigint) => number) {
    let calls = 0
    const source: BlockSource = {
        async latest() {
            return { number: latest, timestamp: timestampOf(latest) }
        },
        async at(number) {
            calls += 1
            return { timestamp: timestampOf(number) }
        }
    }
    return { source, calls: () => calls }
}

const fast = (n: bigint) => 1_794_000_000 + Number(n / 5n)
const slow = (n: bigint) => 1_794_000_000 + Number(n)

function bruteFirst(latest: bigint, timestampOf: (n: bigint) => number, target: number): bigint {
    for (let n = 0n; n <= latest; n++) if (timestampOf(n) >= target) return n
    return latest + 1n
}

describe('block lookup by timestamp', () => {
    it('matches a brute force search on a chain with 200ms blocks', async () => {
        const latest = 60_000n
        for (const target of [1_794_000_000, 1_794_000_003, 1_794_005_000, 1_794_011_999, 1_794_012_000]) {
            const { source } = chain(latest, fast)
            expect(await firstBlockAtOrAfter(source, target)).toBe(bruteFirst(latest, fast, target))
        }
    })

    it('matches a brute force search on a chain with one second blocks', async () => {
        const latest = 5_000n
        for (const target of [1_794_000_000, 1_794_000_001, 1_794_002_500, 1_794_005_000]) {
            const { source } = chain(latest, slow)
            expect(await firstBlockAtOrAfter(source, target)).toBe(bruteFirst(latest, slow, target))
        }
    })

    it('returns the block after the head when the timestamp is in the future', async () => {
        const { source } = chain(100n, slow)
        expect(await firstBlockAtOrAfter(source, 2_000_000_000)).toBe(101n)
    })

    it('returns zero when every block is newer than the target', async () => {
        const { source } = chain(100n, slow)
        expect(await firstBlockAtOrAfter(source, 1)).toBe(0n)
    })

    it('handles long runs of identical timestamps', async () => {
        const flat = (n: bigint) => (n < 50n ? 1_000 : n < 90n ? 2_000 : 3_000)
        const { source } = chain(120n, flat)
        expect(await firstBlockAtOrAfter(source, 2_000)).toBe(50n)
        expect(await lastBlockAtOrBefore(source, 2_000)).toBe(89n)
    })

    it('finds a recent block with few requests even on a very long chain', async () => {
        const latest = 59_700_000n
        const { source, calls } = chain(latest, fast)
        const target = fast(latest) - 70
        const block = await firstBlockAtOrAfter(source, target)
        expect(fast(block)).toBeGreaterThanOrEqual(target)
        expect(fast(block - 1n)).toBeLessThan(target)
        expect(calls()).toBeLessThan(40)
    })

    it('reads each block once when memoized', async () => {
        const { source, calls } = chain(1_000n, slow)
        const cached = memoize(source)
        await firstBlockAtOrAfter(cached, 1_794_000_500)
        const first = calls()
        await firstBlockAtOrAfter(cached, 1_794_000_500)
        expect(calls()).toBe(first)
    })
})

describe('log range chunks', () => {
    it('never exceeds the size and covers the whole interval', () => {
        const ranges = chunkRanges(1_000n, 1_420n, 150n)
        expect(ranges[0]).toEqual([1_000n, 1_149n])
        expect(ranges.at(-1)).toEqual([1_300n, 1_420n])
        for (const [start, end] of ranges) expect(end - start + 1n).toBeLessThanOrEqual(150n)
        const covered = ranges.reduce((total, [start, end]) => total + (end - start + 1n), 0n)
        expect(covered).toBe(421n)
    })

    it('can walk backward from the newest chunk', () => {
        const ranges = chunkRanges(0n, 399n, 200n, 'backward')
        expect(ranges).toEqual([
            [200n, 399n],
            [0n, 199n]
        ])
    })

    it('returns nothing for an empty or inverted interval', () => {
        expect(chunkRanges(10n, 9n, 150n)).toEqual([])
        expect(chunkRanges(5n, 5n, 150n)).toEqual([[5n, 5n]])
    })

    it('stays under the public Base Sepolia limit of 200 blocks', () => {
        for (const [start, end] of chunkRanges(0n, 10_000n, 150n)) {
            expect(end - start + 1n).toBeLessThanOrEqual(200n)
        }
    })
})
