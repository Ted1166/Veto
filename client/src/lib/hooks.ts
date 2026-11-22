import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, EIP1193Provider, Hash, WalletClient } from 'viem'
import { deployment } from '../deployment'
import { type Snapshot, ensureChain, injected, loadSnapshot, publicClient, walletFor } from './chain'

export function useSnapshot() {
    const [snapshot, setSnapshot] = useState<Snapshot>()
    const [failure, setFailure] = useState<string>()

    useEffect(() => {
        let stopped = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let delay = 3000
        let pending = false

        const run = async () => {
            try {
                const next = await loadSnapshot()
                if (stopped) return
                setSnapshot(next)
                setFailure(undefined)
                pending = next.activeId !== 0
                delay = pending ? 1000 : 3000
            } catch (error) {
                if (stopped) return
                setFailure(error instanceof Error ? error.message.split('\n')[0] : 'read failed')
                delay = Math.min(delay * 2, 12000)
            }
            if (!stopped) timer = setTimeout(() => void run(), pending && delay < 3000 ? 1000 : delay)
        }

        void run()
        return () => {
            stopped = true
            clearTimeout(timer)
        }
    }, [])

    return { snapshot, failure }
}

export function useNow(intervalMs = 250): number {
    const [now, setNow] = useState(() => Date.now() / 1000)
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now() / 1000), intervalMs)
        return () => clearInterval(timer)
    }, [intervalMs])
    return now
}

export interface ProviderChoice {
    uuid: string
    name: string
    provider: EIP1193Provider
}

function useProviders(): ProviderChoice[] {
    const [choices, setChoices] = useState<ProviderChoice[]>([])

    useEffect(() => {
        const seen = new Map<string, ProviderChoice>()
        const onAnnounce = (event: Event) => {
            const { info, provider } = (
                event as CustomEvent<{ info: { uuid: string; name: string }; provider: EIP1193Provider }>
            ).detail
            seen.set(info.uuid, { uuid: info.uuid, name: info.name, provider })
            setChoices([...seen.values()])
        }
        window.addEventListener('eip6963:announceProvider', onAnnounce)
        window.dispatchEvent(new Event('eip6963:requestProvider'))
        const fallback = setTimeout(() => {
            const legacy = injected()
            if (legacy && seen.size === 0) {
                seen.set('legacy', { uuid: 'legacy', name: 'Browser wallet', provider: legacy })
                setChoices([...seen.values()])
            }
        }, 600)
        return () => {
            clearTimeout(fallback)
            window.removeEventListener('eip6963:announceProvider', onAnnounce)
        }
    }, [])

    return choices
}

const STORE_KEY = 'veto.wallet'

function remembered(): string | undefined {
    try {
        return window.localStorage.getItem(STORE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

function explain(error: unknown, label: string): string {
    const message = error instanceof Error ? error.message.split('\n')[0] ?? '' : ''
    if (/does not match the target chain/i.test(message)) {
        return 'Your wallet is on a different network. Switch to Base Sepolia and try again.'
    }
    if (/user rejected|denied/i.test(message)) return `${label} cancelled`
    return message || `${label} failed`
}

export function useWallet() {
    const choices = useProviders()
    const [selectedId, setSelectedId] = useState(remembered)
    const [account, setAccount] = useState<Address>()
    const [onChain, setOnChain] = useState(false)
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState<string>()
    const [menuOpen, setMenuOpen] = useState(false)
    const clearer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    const selected =
        choices.find((choice) => choice.uuid === selectedId) ?? (choices.length === 1 ? choices[0] : undefined)
    const provider = selected?.provider

    const say = useCallback((text: string | undefined, holdMs = 8000) => {
        clearTimeout(clearer.current)
        setNote(text)
        if (text && holdMs > 0) clearer.current = setTimeout(() => setNote(undefined), holdMs)
    }, [])

    useEffect(() => {
        if (!provider) return
        const sync = async () => {
            try {
                const accounts = (await provider.request({ method: 'eth_accounts' })) as Address[]
                const id = (await provider.request({ method: 'eth_chainId' })) as string
                setAccount(accounts[0])
                setOnChain(parseInt(id, 16) === deployment.chainId)
            } catch {
                setAccount(undefined)
            }
        }
        void sync()
        const timer = setInterval(() => void sync(), 2000)
        provider.on('accountsChanged', sync)
        provider.on('chainChanged', sync)
        return () => {
            clearInterval(timer)
            provider.removeListener('accountsChanged', sync)
            provider.removeListener('chainChanged', sync)
        }
    }, [provider])

    const connect = useCallback(
        async (choice: ProviderChoice) => {
            try {
                await ensureChain(choice.provider)
                const accounts = (await choice.provider.request({ method: 'eth_requestAccounts' })) as Address[]
                try {
                    window.localStorage.setItem(STORE_KEY, choice.uuid)
                } catch {
                    say(undefined)
                }
                setSelectedId(choice.uuid)
                setAccount(accounts[0])
                setOnChain(true)
                setMenuOpen(false)
                say(undefined)
            } catch (error) {
                say(explain(error, 'Connection'))
            }
        },
        [say]
    )

    const onConnectClick = useCallback(() => {
        if (choices.length === 0) {
            say('No wallet found. Install a browser wallet such as MetaMask.')
        } else if (selected && account) {
            void connect(selected)
        } else if (choices.length > 1 && !selected) {
            setMenuOpen((open) => !open)
        } else {
            const only = selected ?? choices[0]
            if (only) void connect(only)
        }
    }, [choices, selected, account, connect, say])

    const act = useCallback(
        async (label: string, write: (wallet: WalletClient, from: Address) => Promise<Hash>) => {
            if (!provider || !account) return
            setBusy(true)
            say(`${label}: confirm in your wallet`, 0)
            try {
                await ensureChain(provider)
                const hash = await write(walletFor(provider), account)
                say(`${label}: waiting for confirmation`, 0)
                await publicClient.waitForTransactionReceipt({ hash })
                say(`${label} confirmed`)
            } catch (error) {
                say(explain(error, label))
            } finally {
                setBusy(false)
            }
        },
        [provider, account, say]
    )

    return { account, onChain, busy, note, choices, menuOpen, connect, onConnectClick, act }
}
