import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { type Address, type Hex, isAddress } from 'viem'

const backendRoot = resolve(import.meta.dirname, '..')
const contractsRoot = resolve(backendRoot, '../contracts')

const envFile = process.env.HEADS_UP_ENV ?? resolve(contractsRoot, '.env')
if (existsSync(envFile)) loadEnv({ path: envFile })

export const paths = {
    backendRoot,
    contractsRoot,
    deployments: process.env.DEPLOYMENTS_DIR ?? resolve(contractsRoot, 'deployments'),
    data: process.env.DATA_DIR ?? resolve(backendRoot, 'data')
}

function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`${name} is not set. Add it to ${envFile}`)
    return value
}

function numberFrom(name: string, fallback: number): number {
    const value = process.env[name]
    if (!value) return fallback
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`)
    return parsed
}

export interface Settings {
    originRpc: string
    reactiveRpc: string
    privateKey?: Hex
    gapBps: number
    recoverBps: number
    escalateBps: number
    stopPrice: bigint
    appUrl: string
    telegramToken?: string
    telegramChat?: string
    webhookUrl?: string
}

export function loadSettings(): Settings {
    const key = process.env.PRIVATE_KEY
    return {
        originRpc: required('BASE_SEPOLIA_RPC_URL'),
        reactiveRpc: required('REACTIVE_RPC_URL'),
        privateKey: key ? (key as Hex) : undefined,
        gapBps: numberFrom('GAP_BPS', 500),
        recoverBps: numberFrom('RECOVER_BPS', 300),
        escalateBps: numberFrom('ESCALATE_BPS', 500),
        stopPrice: BigInt(process.env.STOP_PRICE ?? '1900000000000000000000'),
        appUrl: process.env.APP_URL ?? 'http://localhost:5173',
        telegramToken: process.env.TELEGRAM_BOT_TOKEN,
        telegramChat: process.env.TELEGRAM_CHAT_ID,
        webhookUrl: process.env.NOTIFY_WEBHOOK_URL
    }
}

export interface Deployment {
    originChainId: number
    reactiveChainId: number
    riskToken: Address
    stableToken: Address
    pool: Address
    vault: Address
    guard: Address
    reactive: Address
    decisionWindow: number
    escalatedWindow: number
}

function readJson(name: string): Record<string, unknown> {
    const file = resolve(paths.deployments, name)
    if (!existsSync(file)) {
        throw new Error(`${file} not found. Deploy first with contracts/scripts/deploy-all.sh`)
    }
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

function address(source: Record<string, unknown>, field: string): Address {
    const value = source[field]
    if (typeof value !== 'string' || !isAddress(value)) {
        throw new Error(`deployments are missing a valid ${field}`)
    }
    return value
}

export function loadDeployment(): Deployment {
    const fixtures = readJson('fixtures.json')
    const guard = readJson('guard.json')
    const reactive = readJson('reactive.json')
    return {
        originChainId: Number(fixtures.chainId),
        reactiveChainId: Number(reactive.chainId),
        riskToken: address(fixtures, 'riskToken'),
        stableToken: address(fixtures, 'stableToken'),
        pool: address(fixtures, 'pool'),
        vault: address(fixtures, 'vault'),
        guard: address(guard, 'guard'),
        reactive: address(reactive, 'reactive'),
        decisionWindow: Number(guard.decisionWindow),
        escalatedWindow: Number(guard.escalatedWindow)
    }
}
