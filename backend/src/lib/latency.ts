import type { StatusName, TriggerName } from '../abi.js'

export interface TxPoint {
    hash: string
    block: number
    timestamp: number
}

export interface Trace {
    actionId: number
    scenario: string
    trigger: TriggerName
    status: StatusName
    executedBps: number
    triggerPrice: string
    decisionWindow: number
    openedAt: number
    deadline: number
    resolvedAt: number
    origin?: TxPoint
    reactive?: TxPoint
    callback?: TxPoint
    decision?: TxPoint & { kind: string }
    timeoutDirective?: TxPoint
    recordedAt: string
}

export const DEFAULT_ORIGIN_BLOCK_MS = 200

export interface Hops {
    originToReactive?: number
    reactiveToCallback?: number
    endToEnd?: number
    endToEndBlocks?: number
    endToEndEstimateMs?: number
    clockSkew?: number
    windowLeft?: number
    windowLeftShare?: number
    decisionAfterOpen?: number
    deadlineToResolved?: number
}

export function computeHops(trace: Trace, originBlockMs = DEFAULT_ORIGIN_BLOCK_MS): Hops {
    const hops: Hops = {}

    if (trace.origin) {
        hops.endToEnd = trace.openedAt - trace.origin.timestamp
        hops.windowLeft = trace.decisionWindow - hops.endToEnd
        hops.windowLeftShare = hops.windowLeft / trace.decisionWindow
    }
    if (trace.origin && trace.callback) {
        hops.endToEndBlocks = trace.callback.block - trace.origin.block
        hops.endToEndEstimateMs = hops.endToEndBlocks * originBlockMs
    }

    if (trace.origin && trace.reactive) {
        const raw = trace.reactive.timestamp - trace.origin.timestamp
        if (raw < 0) {
            hops.clockSkew = -raw
            hops.originToReactive = 0
        } else {
            hops.originToReactive = raw
        }
    }
    if (trace.reactive && trace.callback) {
        const raw = trace.callback.timestamp - trace.reactive.timestamp
        hops.reactiveToCallback = raw - (hops.clockSkew ?? 0)
    }

    if (trace.decision) {
        hops.decisionAfterOpen = trace.decision.timestamp - trace.openedAt
    }
    if (trace.status === 'Defaulted') {
        hops.deadlineToResolved = trace.resolvedAt - trace.deadline
    }
    return hops
}

export interface Summary {
    count: number
    min: number
    max: number
    mean: number
}

export function summarize(values: number[]): Summary | undefined {
    if (values.length === 0) return undefined
    const total = values.reduce((sum, value) => sum + value, 0)
    return {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        mean: total / values.length
    }
}

function cell(value: number | undefined, suffix = 's'): string {
    return value === undefined ? 'n/a' : `${value}${suffix}`
}

function short(point: TxPoint | undefined): string {
    return point ? `${point.hash.slice(0, 10)}...${point.hash.slice(-6)}` : 'n/a'
}

function linked(point: TxPoint | undefined, explorer?: string): string {
    if (!point) return 'n/a'
    return explorer ? `[${short(point)}](${explorer}/tx/${point.hash})` : short(point)
}

function whole(point: TxPoint | undefined): string {
    return point ? `\`${point.hash}\`` : 'n/a'
}

function endToEndCell(hops: Hops): string {
    if (hops.endToEnd === undefined) return 'n/a'
    if (hops.endToEndBlocks === undefined || hops.endToEndEstimateMs === undefined) {
        return `${hops.endToEnd}s`
    }
    return `${hops.endToEnd}s (${hops.endToEndBlocks} blocks, ~${(hops.endToEndEstimateMs / 1000).toFixed(1)}s)`
}

export function describeEndToEnd(
    traces: Trace[],
    originBlockMs = DEFAULT_ORIGIN_BLOCK_MS
): string | undefined {
    const all = traces.map((trace) => computeHops(trace, originBlockMs))
    const seconds = summarize(all.map((hops) => hops.endToEnd).filter((v): v is number => v !== undefined))
    if (!seconds) return undefined
    const estimates = summarize(
        all.map((hops) => hops.endToEndEstimateMs).filter((v): v is number => v !== undefined)
    )
    let line = `End to end over ${seconds.count} actions by block timestamp: min ${seconds.min}s, mean ${seconds.mean.toFixed(1)}s, max ${seconds.max}s.`
    if (estimates) {
        line += ` Estimated from block counts at ${originBlockMs}ms per block: min ${(estimates.min / 1000).toFixed(1)}s, mean ${(estimates.mean / 1000).toFixed(1)}s, max ${(estimates.max / 1000).toFixed(1)}s.`
    }
    return line
}

const SCENARIO_ORDER = ['approve', 'resize', 'veto', 'timeout', 'recover', 'escalate']

export function latestPerScenario(traces: Trace[]): Trace[] {
    const latest = new Map<string, Trace>()
    for (const trace of traces) {
        const current = latest.get(trace.scenario)
        if (!current || trace.actionId > current.actionId) latest.set(trace.scenario, trace)
    }
    const rank = (scenario: string) => {
        const index = SCENARIO_ORDER.indexOf(scenario)
        return index === -1 ? SCENARIO_ORDER.length : index
    }
    return [...latest.values()].sort(
        (a, b) => rank(a.scenario) - rank(b.scenario) || a.actionId - b.actionId
    )
}

export function toMarkdown(
    traces: Trace[],
    originBlockMs = DEFAULT_ORIGIN_BLOCK_MS,
    explorer?: string
): string {
    const lines: string[] = []
    lines.push('| Scenario | Action | Trigger | Outcome | Origin to reactive | Reactive to callback | End to end | Window left | Deadline to resolved |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')

    const all = traces.map((trace) => computeHops(trace, originBlockMs))
    traces.forEach((trace, index) => {
        const hops = all[index] as Hops
        lines.push(
            `| ${trace.scenario} | ${trace.actionId} | ${trace.trigger} | ${trace.status} | ${cell(hops.originToReactive)} | ${cell(hops.reactiveToCallback)} | ${endToEndCell(hops)} | ${cell(hops.windowLeft)} | ${cell(hops.deadlineToResolved)} |`
        )
    })

    const summary = describeEndToEnd(traces, originBlockMs)
    if (summary) {
        lines.push('')
        lines.push(summary)
    }

    if (all.some((hops) => (hops.clockSkew ?? 0) > 0)) {
        lines.push('')
        lines.push(
            'The reactive chain and the origin chain stamp blocks with different clocks. Where a reactive block is stamped earlier than the swap that caused it, that hop is shown as 0s and the difference is taken out of the callback hop. End to end is measured on the origin chain alone and is unaffected.'
        )
    }

    lines.push('')
    lines.push('| Action | Origin swap | Reactive transaction | Callback transaction | Decision | Default requested |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const trace of traces) {
        const decision = trace.decision
            ? `${trace.decision.kind} ${linked(trace.decision, explorer)}`
            : 'none'
        const reactive = explorer ? whole(trace.reactive) : short(trace.reactive)
        const directive = explorer ? whole(trace.timeoutDirective) : short(trace.timeoutDirective)
        lines.push(
            `| ${trace.actionId} | ${linked(trace.origin, explorer)} | ${reactive} | ${linked(trace.callback, explorer)} | ${decision} | ${directive} |`
        )
    }
    return lines.join('\n')
}
