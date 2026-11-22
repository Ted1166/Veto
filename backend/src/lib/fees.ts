export const FEE_HEADROOM_BPS = 12_500n

export function legacyGasPrice(networkPrice: bigint, headroomBps = FEE_HEADROOM_BPS): bigint {
    const padded = (networkPrice * headroomBps) / 10_000n
    return padded > 0n ? padded : 1n
}

export const TRANSFER_FEE_RESERVE = 10_000_000_000_000_000n

export function maxFundable(balance: bigint, reserve = TRANSFER_FEE_RESERVE): bigint {
    return balance > reserve ? balance - reserve : 0n
}
