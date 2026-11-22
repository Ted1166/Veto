const ONE = 10n ** 18n

export function price(value: bigint): string {
    const cents = (value * 100n) / ONE
    return `${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`
}

export function tokens(value: bigint, digits = 2): string {
    const scale = 10n ** BigInt(digits)
    const scaled = (value * scale) / ONE
    const fraction = (scaled % scale).toString().padStart(digits, '0')
    return `${(scaled / scale).toLocaleString('en-US')}.${fraction}`
}

export function short(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export const TRIGGERS = ['Stop-loss proximity', 'Price gap'] as const
export const STATUSES = ['None', 'Pending', 'Approved', 'Resized', 'Vetoed', 'Defaulted', 'Cancelled'] as const

export function triggerLabel(value: number): string {
    return TRIGGERS[value] ?? 'Unknown'
}

export function statusLabel(value: number): string {
    return STATUSES[value] ?? 'Unknown'
}

export function percent(bps: number): string {
    return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`
}
