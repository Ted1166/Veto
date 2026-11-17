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

export interface Hops {
    originToReactive?: number
    reactiveToCallback?: number
    endToEnd?: number
    windowLeft?: number
    windowLeftShare?: number
    decisionAfterOpen?: number
    deadlineToResolved?: number
}

export function computeHops(trace: Trace): Hops {
    const hops: Hops = {}
    if (trace.origin && trace.reactive) {
        hops.originToReactive = trace.reactive.timestamp - trace.origin.timestamp
    }
    if (trace.reactive && trace.callback) {
        hops.reactiveToCallback = trace.callback.timestamp - trace.reactive.timestamp
    }
    if (trace.origin) {
        hops.endToEnd = trace.openedAt - trace.origin.timestamp
        hops.windowLeft = trace.decisionWindow - hops.endToEnd
        hops.windowLeftShare = hops.windowLeft / trace.decisionWindow
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

export function toMarkdown(traces: Trace[]): string {
    const lines: string[] = []
    lines.push('| Scenario | Action | Trigger | Outcome | Origin to reactive | Reactive to callback | End to end | Window left | Deadline to resolved |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const trace of traces) {
        const hops = computeHops(trace)
        lines.push(
            `| ${trace.scenario} | ${trace.actionId} | ${trace.trigger} | ${trace.status} | ${cell(hops.originToReactive)} | ${cell(hops.reactiveToCallback)} | ${cell(hops.endToEnd)} | ${cell(hops.windowLeft)} | ${cell(hops.deadlineToResolved)} |`
        )
    }

    const endToEnd = summarize(
        traces.map((trace) => computeHops(trace).endToEnd).filter((v): v is number => v !== undefined)
    )
    if (endToEnd) {
        lines.push('')
        lines.push(
            `End to end over ${endToEnd.count} actions: min ${endToEnd.min}s, mean ${endToEnd.mean.toFixed(1)}s, max ${endToEnd.max}s. Block timestamps have one second resolution.`
        )
    }

    lines.push('')
    lines.push('| Action | Origin swap | Reactive transaction | Callback transaction | Decision | Default requested |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const trace of traces) {
        const decision = trace.decision ? `${trace.decision.kind} ${short(trace.decision)}` : 'none'
        lines.push(
            `| ${trace.actionId} | ${short(trace.origin)} | ${short(trace.reactive)} | ${short(trace.callback)} | ${decision} | ${short(trace.timeoutDirective)} |`
        )
    }
    return lines.join('\n')
}
