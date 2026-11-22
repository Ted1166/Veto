import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { paths } from '../config.js'
import { type Trace, toMarkdown } from './latency.js'

const tracesFile = () => resolve(paths.data, 'traces.json')
const markdownFile = () => resolve(paths.data, 'latency.md')
const submissionFile = () => resolve(paths.data, 'submission.md')

export function readTraces(): Trace[] {
    if (!existsSync(tracesFile())) return []
    return JSON.parse(readFileSync(tracesFile(), 'utf8')) as Trace[]
}

export function appendTrace(trace: Trace): Trace[] {
    mkdirSync(paths.data, { recursive: true })
    const traces = readTraces().filter(
        (existing) => !(existing.actionId === trace.actionId && existing.scenario === trace.scenario)
    )
    traces.push(trace)
    writeFileSync(tracesFile(), JSON.stringify(traces, null, 2))
    writeFileSync(markdownFile(), toMarkdown(traces))
    return traces
}

export function markdownPath(): string {
    return markdownFile()
}

export function writeSubmission(markdown: string): string {
    mkdirSync(paths.data, { recursive: true })
    writeFileSync(submissionFile(), markdown)
    return submissionFile()
}
