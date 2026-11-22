export interface BlockSource {
    latest(): Promise<{ number: bigint; timestamp: number }>
    at(number: bigint): Promise<{ timestamp: number }>
}

export function memoize(source: BlockSource): BlockSource {
    const cache = new Map<bigint, { timestamp: number }>()
    return {
        latest: () => source.latest(),
        async at(number) {
            const hit = cache.get(number)
            if (hit) return hit
            const block = await source.at(number)
            cache.set(number, block)
            return block
        }
    }
}

export async function firstBlockAtOrAfter(source: BlockSource, timestamp: number): Promise<bigint> {
    const latest = await source.latest()
    if (timestamp > latest.timestamp) return latest.number + 1n

    let hi = latest.number
    let step = 1n
    let lo = hi

    for (; ;) {
        lo = hi > step ? hi - step : 0n
        const block = await source.at(lo)
        if (block.timestamp < timestamp) break
        hi = lo
        if (lo === 0n) return 0n
        step *= 2n
    }

    while (hi - lo > 1n) {
        const mid = (lo + hi) / 2n
        const block = await source.at(mid)
        if (block.timestamp >= timestamp) hi = mid
        else lo = mid
    }
    return hi
}

export async function lastBlockAtOrBefore(source: BlockSource, timestamp: number): Promise<bigint> {
    const next = await firstBlockAtOrAfter(source, timestamp + 1)
    return next > 0n ? next - 1n : 0n
}

export function chunkRanges(
    from: bigint,
    to: bigint,
    size: bigint,
    order: 'forward' | 'backward' = 'forward'
): Array<[bigint, bigint]> {
    if (to < from || size < 1n) return []
    const ranges: Array<[bigint, bigint]> = []
    for (let start = from; start <= to; start += size) {
        const end = start + size - 1n > to ? to : start + size - 1n
        ranges.push([start, end])
    }
    return order === 'backward' ? ranges.reverse() : ranges
}

export function logRange(): bigint {
    const value = Number(process.env.LOG_RANGE ?? 150)
    return BigInt(Number.isFinite(value) && value >= 1 ? Math.floor(value) : 150)
}
