import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadDeployment, loadSettings } from './config.js'

export function createContext() {
    const settings = loadSettings()
    const deployment = loadDeployment()

    const originChain = defineChain({
        id: deployment.originChainId,
        name: 'origin',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [settings.originRpc] } }
    })
    const reactiveChain = defineChain({
        id: deployment.reactiveChainId,
        name: 'reactive',
        nativeCurrency: { name: 'Reactive', symbol: 'REACT', decimals: 18 },
        rpcUrls: { default: { http: [settings.reactiveRpc] } }
    })

    const transport = (url: string) => http(url, { retryCount: 6, retryDelay: 500, timeout: 20_000 })

    const origin = createPublicClient({ chain: originChain, transport: transport(settings.originRpc) })
    const reactive = createPublicClient({
        chain: reactiveChain,
        transport: transport(settings.reactiveRpc)
    })

    const account = settings.privateKey ? privateKeyToAccount(settings.privateKey) : undefined
    const wallet = account
        ? createWalletClient({ account, chain: originChain, transport: transport(settings.originRpc) })
        : undefined

    const reactiveWallet = account
        ? createWalletClient({
            account,
            chain: reactiveChain,
            transport: transport(settings.reactiveRpc)
        })
        : undefined

    return {
        settings,
        deployment,
        originChain,
        reactiveChain,
        origin,
        reactive,
        account,
        wallet,
        reactiveWallet
    }
}

export type Context = ReturnType<typeof createContext>

export function requireWallet(ctx: Context) {
    if (!ctx.wallet || !ctx.account) {
        throw new Error('PRIVATE_KEY is required for this command')
    }
    return { wallet: ctx.wallet, account: ctx.account }
}

export function requireReactiveWallet(ctx: Context) {
    if (!ctx.reactiveWallet || !ctx.account) {
        throw new Error('PRIVATE_KEY is required for this command')
    }
    return { wallet: ctx.reactiveWallet, account: ctx.account }
}
