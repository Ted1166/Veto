import {
    type Address,
    type Hex,
    type Log,
    createTestClient,
    createWalletClient,
    http,
    pad,
    parseAbiItem
} from 'viem'
import { guardAbi, mockSystemAbi, poolAbi, reactiveAbi } from '../src/abi.js'
import { createContext } from '../src/clients.js'
import { sleep } from '../src/lib/chain.js'
import { priceOf } from '../src/lib/market.js'

const SYSTEM: Address = '0x8888888888888888888888888888888888888888'
const PROXY: Address = '0x476F44b11F5C942c58f4c8E3d0300E5710743585'
const CRON_SOURCE: Address = '0x0000000000000000000000000000000000fffFfF'
const POLL_MS = 250

const guardEvents = [
    parseAbiItem(
        'event ActionOpened(uint256 indexed id, uint8 trigger, uint16 proposedBps, uint256 triggerPrice, uint64 deadline)'
    ),
    parseAbiItem(
        'event ActionEscalated(uint256 indexed id, uint16 proposedBps, uint256 price, uint64 deadline)'
    ),
    parseAbiItem(
        'event ActionResolved(uint256 indexed id, uint8 status, uint16 executedBps, uint256 stableReceived)'
    )
]

function stamp(message: string) {
    console.log(`[sim ${new Date().toISOString().slice(11, 19)}] ${message}`)
}

async function main() {
    const ctx = createContext()
    const { deployment, settings } = ctx

    const originAdmin = createTestClient({
        chain: ctx.originChain,
        mode: 'anvil',
        transport: http(settings.originRpc)
    })
    const reactiveAdmin = createTestClient({
        chain: ctx.reactiveChain,
        mode: 'anvil',
        transport: http(settings.reactiveRpc)
    })

    await reactiveAdmin.setBalance({ address: SYSTEM, value: 10n ** 21n })
    await reactiveAdmin.impersonateAccount({ address: SYSTEM })
    await originAdmin.setBalance({ address: PROXY, value: 10n ** 21n })
    await originAdmin.impersonateAccount({ address: PROXY })

    const systemWallet = createWalletClient({
        account: SYSTEM,
        chain: ctx.reactiveChain,
        transport: http(settings.reactiveRpc)
    })
    const proxyWallet = createWalletClient({
        account: PROXY,
        chain: ctx.originChain,
        transport: http(settings.originRpc)
    })

    const tickTopic = await ctx.reactive.readContract({
        address: deployment.reactive,
        abi: reactiveAbi,
        functionName: 'TICK_TOPIC'
    })

    let cursor = await ctx.origin.getBlockNumber()
    let delivered = Number(
        await ctx.reactive.readContract({
            address: SYSTEM,
            abi: mockSystemAbi,
            functionName: 'callbackCount'
        })
    )
    let lastTick = 0

    const react = async (record: {
        chainId: bigint
        contractAddress: Address
        topic0: bigint
        topic1: bigint
        topic2: bigint
        topic3: bigint
        data: Hex
        blockNumber: bigint
        opCode: bigint
        blockHash: bigint
        txHash: bigint
        logIndex: bigint
    }) => {
        const hash = await systemWallet.writeContract({
            address: deployment.reactive,
            abi: reactiveAbi,
            functionName: 'react',
            args: [record],
            gas: 3_000_000n
        })
        const receipt = await ctx.reactive.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') stamp(`react reverted ${hash}`)
    }

    const toRecord = (log: Log) => {
        const topics = log.topics as Hex[]
        const topic = (index: number) => (topics[index] ? BigInt(topics[index] as Hex) : 0n)
        return {
            chainId: BigInt(deployment.originChainId),
            contractAddress: log.address as Address,
            topic0: topic(0),
            topic1: topic(1),
            topic2: topic(2),
            topic3: topic(3),
            data: log.data as Hex,
            blockNumber: log.blockNumber ?? 0n,
            opCode: BigInt(topics.length),
            blockHash: 0n,
            txHash: log.transactionHash ? BigInt(log.transactionHash) : 0n,
            logIndex: BigInt(log.logIndex ?? 0)
        }
    }

    stamp(`simulating the reactive network between ${settings.originRpc} and ${settings.reactiveRpc}`)

    for (; ;) {
        await sleep(POLL_MS)

        const latest = await ctx.origin.getBlockNumber()
        if (latest > cursor) {
            const range = { fromBlock: cursor + 1n, toBlock: latest }
            cursor = latest

            const [syncs, ...guardLogs] = await Promise.all([
                ctx.origin.getLogs({
                    address: deployment.pool,
                    event: poolAbi.find((item) => item.type === 'event' && item.name === 'Sync') as never,
                    ...range
                }),
                ...guardEvents.map((event) =>
                    ctx.origin.getLogs({ address: deployment.guard, event, ...range })
                )
            ])

            const ordered = [...(syncs as Log[]), ...guardLogs.flat()].sort((a, b) =>
                a.blockNumber === b.blockNumber
                    ? Number((a.logIndex ?? 0) - (b.logIndex ?? 0))
                    : Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n))
            )

            for (const log of ordered) {
                const record = toRecord(log)
                if (log.address.toLowerCase() === deployment.pool.toLowerCase()) {
                    const [risk, stable] = [BigInt(`0x${log.data.slice(2, 66)}`), BigInt(`0x${log.data.slice(66, 130)}`)]
                    stamp(`pool Sync price ${priceOf({ risk, stable }) / 10n ** 16n}e-2`)
                } else {
                    stamp(`guard event ${log.transactionHash?.slice(0, 10)}`)
                }
                await react(record)
            }
        }

        const tickActive = await ctx.reactive.readContract({
            address: deployment.reactive,
            abi: reactiveAbi,
            functionName: 'tickActive'
        })
        if (tickActive && Date.now() - lastTick >= 1_000) {
            lastTick = Date.now()
            await react({
                chainId: BigInt(deployment.reactiveChainId),
                contractAddress: CRON_SOURCE,
                topic0: tickTopic,
                topic1: 0n,
                topic2: 0n,
                topic3: 0n,
                data: '0x',
                blockNumber: 0n,
                opCode: 1n,
                blockHash: 0n,
                txHash: 0n,
                logIndex: 0n
            })
        }

        const count = Number(
            await ctx.reactive.readContract({
                address: SYSTEM,
                abi: mockSystemAbi,
                functionName: 'callbackCount'
            })
        )
        while (delivered < count) {
            const callback = await ctx.reactive.readContract({
                address: SYSTEM,
                abi: mockSystemAbi,
                functionName: 'callbackAt',
                args: [BigInt(delivered)]
            })
            delivered += 1

            const body = callback.payload.slice(2)
            const selector = body.slice(0, 8)
            const rest = body.slice(72)
            const patched = `0x${selector}${pad(deployment.reactive, { size: 32 }).slice(2)}${rest}` as Hex

            try {
                const hash = await proxyWallet.sendTransaction({
                    to: callback.recipient,
                    data: patched,
                    gas: callback.gasLimit
                })
                const receipt = await ctx.origin.waitForTransactionReceipt({ hash })
                stamp(`callback ${selector} delivered: ${receipt.status}`)
            } catch (error) {
                stamp(`callback ${selector} failed: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
            }
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
