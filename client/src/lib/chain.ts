import {
    type Address,
    type EIP1193Provider,
    createPublicClient,
    createWalletClient,
    custom,
    defineChain,
    http,
    parseAbi
} from 'viem'
import { deployment } from '../deployment'

export const guardAbi = parseAbi([
    'function owner() view returns (address)',
    'function actionCount() view returns (uint256)',
    'function activeActionId() view returns (uint256)',
    'function approve(uint256 id)',
    'function resize(uint256 id, uint16 bps)',
    'function veto(uint256 id)',
    'function executeDefault(uint256 id)',
    'function getAction(uint256 id) view returns ((uint8 trigger, uint8 status, bool escalated, uint16 proposedBps, uint16 executedBps, uint64 openedAt, uint64 deadline, uint64 resolvedAt, uint256 triggerPrice, uint256 latestPrice, uint256 stableReceived))'
])

const poolAbi = parseAbi(['function spotPrice() view returns (uint256)'])
const vaultAbi = parseAbi([
    'function riskBalance() view returns (uint256)',
    'function stableBalance() view returns (uint256)'
])

export const chain = defineChain({
    id: deployment.chainId,
    name: 'Base Sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [deployment.rpcUrl] } },
    blockExplorers: { default: { name: 'Basescan', url: deployment.explorer } },
    contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } }
})

export const publicClient = createPublicClient({
    chain,
    transport: http(deployment.rpcUrl, { batch: true, retryCount: 4, retryDelay: 600 })
})

export interface ActionView {
    id: number
    trigger: number
    status: number
    escalated: boolean
    proposedBps: number
    executedBps: number
    openedAt: number
    deadline: number
    resolvedAt: number
    triggerPrice: bigint
    stableReceived: bigint
}

export interface Snapshot {
    price: bigint
    vaultRisk: bigint
    vaultStable: bigint
    owner: Address
    count: number
    activeId: number
    actions: ActionView[]
    chainOffset: number
}

const PENDING = 1
const settled = new Map<number, ActionView>()

export function clearActionCache(): void {
    settled.clear()
}

type RawAction = {
    trigger: number
    status: number
    escalated: boolean
    proposedBps: number
    executedBps: number
    openedAt: bigint
    deadline: bigint
    resolvedAt: bigint
    triggerPrice: bigint
    stableReceived: bigint
}

function toView(id: number, a: RawAction): ActionView {
    return {
        id,
        trigger: a.trigger,
        status: a.status,
        escalated: a.escalated,
        proposedBps: a.proposedBps,
        executedBps: a.executedBps,
        openedAt: Number(a.openedAt),
        deadline: Number(a.deadline),
        resolvedAt: Number(a.resolvedAt),
        triggerPrice: a.triggerPrice,
        stableReceived: a.stableReceived
    }
}

async function readActions(ids: number[]): Promise<ActionView[]> {
    const missing = ids.filter((id) => !settled.has(id))
    const fetched = new Map<number, ActionView>()
    if (missing.length > 0) {
        const results = await publicClient.multicall({
            allowFailure: false,
            contracts: missing.map(
                (id) =>
                    ({
                        address: deployment.guard,
                        abi: guardAbi,
                        functionName: 'getAction',
                        args: [BigInt(id)]
                    }) as const
            )
        })
        results.forEach((raw, index) => {
            const id = missing[index] as number
            const view = toView(id, raw)
            fetched.set(id, view)
            if (view.status !== PENDING) settled.set(id, view)
        })
    }
    return ids.map((id) => (settled.get(id) ?? fetched.get(id)) as ActionView)
}

export async function loadSnapshot(): Promise<Snapshot> {
    const guard = deployment.guard
    const [[price, vaultRisk, vaultStable, owner, count, activeId], block] = await Promise.all([
        publicClient.multicall({
            allowFailure: false,
            contracts: [
                { address: deployment.pool, abi: poolAbi, functionName: 'spotPrice' },
                { address: deployment.vault, abi: vaultAbi, functionName: 'riskBalance' },
                { address: deployment.vault, abi: vaultAbi, functionName: 'stableBalance' },
                { address: guard, abi: guardAbi, functionName: 'owner' },
                { address: guard, abi: guardAbi, functionName: 'actionCount' },
                { address: guard, abi: guardAbi, functionName: 'activeActionId' }
            ]
        }),
        publicClient.getBlock({ blockTag: 'latest' })
    ])
    const total = Number(count)
    const ids = Array.from({ length: Math.min(total, 12) }, (_, index) => total - index)
    const actions = await readActions(ids)
    return {
        price,
        vaultRisk,
        vaultStable,
        owner,
        count: total,
        activeId: Number(activeId),
        actions,
        chainOffset: Number(block.timestamp) - Math.floor(Date.now() / 1000)
    }
}

export function injected(): EIP1193Provider | undefined {
    return (window as unknown as { ethereum?: EIP1193Provider }).ethereum
}

export function walletFor(provider: EIP1193Provider) {
    return createWalletClient({ chain, transport: custom(provider) })
}

export async function ensureChain(provider: EIP1193Provider): Promise<void> {
    const chainId = `0x${deployment.chainId.toString(16)}` as const
    try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
    } catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error
        await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
                {
                    chainId,
                    chainName: chain.name,
                    nativeCurrency: chain.nativeCurrency,
                    rpcUrls: [deployment.rpcUrl],
                    blockExplorerUrls: [deployment.explorer]
                }
            ]
        })
    }
}
