import { describe, expect, it } from 'vitest'
import { waitUntil } from '../src/lib/wait.js'

describe('waitUntil', () => {
    it('returns the first usable result', async () => {
        let calls = 0
        const value = await waitUntil(
            'a value',
            async () => (++calls >= 3 ? 'ready' : undefined),
            { timeoutMs: 1_000, intervalMs: 5 }
        )
        expect(value).toBe('ready')
        expect(calls).toBe(3)
    })

    it('keeps polling through network failures and recovers', async () => {
        let calls = 0
        const value = await waitUntil(
            'the network to come back',
            async () => {
                calls += 1
                if (calls <= 3) throw new TypeError('fetch failed')
                return 42
            },
            { timeoutMs: 1_000, intervalMs: 5 }
        )
        expect(value).toBe(42)
        expect(calls).toBe(4)
    })

    it('reports the last error when it times out', async () => {
        await expect(
            waitUntil(
                'something broken',
                async () => {
                    throw new Error('fetch failed\nsecond line')
                },
                { timeoutMs: 40, intervalMs: 5 }
            )
        ).rejects.toThrow('timed out waiting for something broken (last error: fetch failed)')
    })

    it('times out cleanly when the condition never holds', async () => {
        await expect(
            waitUntil('never', async () => false, { timeoutMs: 30, intervalMs: 5 })
        ).rejects.toThrow('timed out waiting for never')
    })

    it('treats zero as a usable result', async () => {
        expect(await waitUntil('zero', async () => 0, { timeoutMs: 100, intervalMs: 5 })).toBe(0)
    })
})
