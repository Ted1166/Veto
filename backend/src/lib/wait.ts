export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message.split('\n')[0] ?? 'unknown error' : String(error)
}

export async function waitUntil<T>(
    label: string,
    probe: () => Promise<T | undefined | false>,
    options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 90_000
    const intervalMs = options.intervalMs ?? 1_000
    const deadline = Date.now() + timeoutMs
    let lastError: string | undefined

    for (; ;) {
        try {
            const result = await probe()
            if (result !== undefined && result !== false) return result
        } catch (error) {
            lastError = describe(error)
        }
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${label}${lastError ? ` (last error: ${lastError})` : ''}`)
        }
        await sleep(intervalMs)
    }
}
