import { parseAbiItem } from 'viem'
import { statusName, triggerName } from './abi.js'
import { createContext } from './clients.js'
import { sleep } from './lib/chain.js'
import { formatPrice } from './lib/market.js'

const opened = parseAbiItem(
    'event ActionOpened(uint256 indexed id, uint8 trigger, uint16 proposedBps, uint256 triggerPrice, uint64 deadline)'
)
const escalated = parseAbiItem(
    'event ActionEscalated(uint256 indexed id, uint16 proposedBps, uint256 price, uint64 deadline)'
)
const resolved = parseAbiItem(
    'event ActionResolved(uint256 indexed id, uint8 status, uint16 executedBps, uint256 stableReceived)'
)

async function deliver(text: string, link: string) {
    const { settings } = createContext()
    console.log(`${text}\n${link}`)

    if (settings.telegramToken && settings.telegramChat) {
        const response = await fetch(
            `https://api.telegram.org/bot${settings.telegramToken}/sendMessage`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    chat_id: settings.telegramChat,
                    text: `${text}\n${link}`,
                    disable_web_page_preview: true
                })
            }
        )
        if (!response.ok) console.error('telegram delivery failed', response.status)
    }

    if (settings.webhookUrl) {
        const response = await fetch(settings.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, link })
        })
        if (!response.ok) console.error('webhook delivery failed', response.status)
    }
}

async function main() {
    const ctx = createContext()
    let cursor = await ctx.origin.getBlockNumber()
    console.log(`watching ${ctx.deployment.guard} from block ${cursor}`)

    for (; ;) {
        await sleep(1_500)
        const latest = await ctx.origin.getBlockNumber()
        if (latest <= cursor) continue
        const range = { fromBlock: cursor + 1n, toBlock: latest }
        cursor = latest

        const [openedLogs, escalatedLogs, resolvedLogs] = await Promise.all([
            ctx.origin.getLogs({ address: ctx.deployment.guard, event: opened, ...range }),
            ctx.origin.getLogs({ address: ctx.deployment.guard, event: escalated, ...range }),
            ctx.origin.getLogs({ address: ctx.deployment.guard, event: resolved, ...range })
        ])

        for (const log of openedLogs) {
            const { id, trigger, proposedBps, triggerPrice, deadline } = log.args
            if (id === undefined || trigger === undefined || triggerPrice === undefined) continue
            const left = Math.max(0, Number(deadline) - Math.floor(Date.now() / 1000))
            await deliver(
                `Heads-Up: ${triggerName(trigger)} at ${formatPrice(triggerPrice)}. ${(Number(proposedBps) / 100).toFixed(0)} percent reduction proposed, about ${left}s to decide.`,
                `${ctx.settings.appUrl}/#action-${id}`
            )
        }
        for (const log of escalatedLogs) {
            const { id, price, deadline } = log.args
            if (id === undefined || price === undefined) continue
            const left = Math.max(0, Number(deadline) - Math.floor(Date.now() / 1000))
            await deliver(
                `Heads-Up escalation: price fell to ${formatPrice(price)}. Full exit proposed, about ${left}s left.`,
                `${ctx.settings.appUrl}/#action-${id}`
            )
        }
        for (const log of resolvedLogs) {
            const { id, status, executedBps } = log.args
            if (id === undefined || status === undefined) continue
            await deliver(
                `Heads-Up action ${id} ended as ${statusName(status)}, ${executedBps} bps executed.`,
                `${ctx.settings.appUrl}/#action-${id}`
            )
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
