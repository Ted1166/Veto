import { parseAbi } from 'viem'

export const poolAbi = parseAbi([
    'function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to) returns (uint256)',
    'function getReserves() view returns (uint112, uint112)',
    'function spotPrice() view returns (uint256)',
    'function quote(address tokenIn, uint256 amountIn) view returns (uint256)',
    'event Sync(uint112 reserve0, uint112 reserve1)',
    'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'
])

export const tokenAbi = parseAbi([
    'function mint(address to, uint256 amount)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)'
])

export const vaultAbi = parseAbi([
    'function owner() view returns (address)',
    'function guard() view returns (address)',
    'function riskBalance() view returns (uint256)',
    'function stableBalance() view returns (uint256)'
])

export const guardAbi = parseAbi([
    'function actionCount() view returns (uint256)',
    'function activeActionId() view returns (uint256)',
    'function timeLeft(uint256 id) view returns (uint256)',
    'function approve(uint256 id)',
    'function resize(uint256 id, uint16 bps)',
    'function veto(uint256 id)',
    'function executeDefault(uint256 id)',
    'function getAction(uint256 id) view returns ((uint8 trigger, uint8 status, bool escalated, uint16 proposedBps, uint16 executedBps, uint64 openedAt, uint64 deadline, uint64 resolvedAt, uint256 triggerPrice, uint256 latestPrice, uint256 stableReceived))',
    'event ActionOpened(uint256 indexed id, uint8 trigger, uint16 proposedBps, uint256 triggerPrice, uint64 deadline)',
    'event ActionEscalated(uint256 indexed id, uint16 proposedBps, uint256 price, uint64 deadline)',
    'event ActionResolved(uint256 indexed id, uint8 status, uint16 executedBps, uint256 stableReceived)',
    'event OpenIgnored(uint256 activeId, uint256 price)'
])

export const reactiveAbi = parseAbi([
    'function lastPrice() view returns (uint256)',
    'function pendingActive() view returns (bool)',
    'function pendingId() view returns (uint256)',
    'function cooldownUntil() view returns (uint64)',
    'function stopDisarmed() view returns (bool)',
    'function tickActive() view returns (bool)',
    'function TICK_TOPIC() view returns (uint256)',
    'function react((uint256 chainId, address contractAddress, uint256 topic0, uint256 topic1, uint256 topic2, uint256 topic3, bytes data, uint256 blockNumber, uint256 opCode, uint256 blockHash, uint256 txHash, uint256 logIndex) log)',
    'event TriggerFired(uint8 indexed trigger, uint256 price, uint256 previousPrice)',
    'event DirectiveSent(uint8 indexed directive, uint256 indexed actionId, uint256 price)',
    'event PendingTracked(uint256 indexed actionId, uint256 anchorPrice, uint64 deadline)',
    'event PendingCleared(uint256 indexed actionId, uint64 cooldownUntil)'
])

export const mockSystemAbi = parseAbi([
    'function callbackCount() view returns (uint256)',
    'function callbackAt(uint256 index) view returns ((uint256 chainId, address recipient, uint64 gasLimit, bytes payload))'
])

export const TRIGGERS = ['StopLossProximity', 'PriceGap'] as const
export const STATUSES = [
    'None',
    'Pending',
    'Approved',
    'Resized',
    'Vetoed',
    'Defaulted',
    'Cancelled'
] as const
export const DIRECTIVES = ['Cancel', 'Escalate', 'ExecuteDefault'] as const

export type TriggerName = (typeof TRIGGERS)[number]
export type StatusName = (typeof STATUSES)[number]

export function triggerName(value: number): TriggerName {
    return TRIGGERS[value] ?? 'StopLossProximity'
}

export function statusName(value: number): StatusName {
    return STATUSES[value] ?? 'None'
}

export const STATUS_PENDING = 1
