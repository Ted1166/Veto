# Backend

Node and TypeScript tooling around the contracts: a swap bot that moves the pool price on demand, a notifier, a latency indexer that stitches every hop of the loop into one table with transaction hashes, a scripted demo runner, and an offline network simulator for rehearsing without spending lREACT.

It reads the keys and RPC URLs from `../contracts/.env` and the addresses from `../contracts/deployments/*.json`, so there is nothing to configure after deploying the contracts.

## Setup

```
cd backend
npm install
npm test
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run status` | Pool price, reactive contract state, guard actions, vault, contract and wallet balances |
| `npm run bot -- funds` | Mints test tokens to your wallet and approves the pool |
| `npm run bot -- prime` | Small buy so the reactive contract records a starting price |
| `npm run bot -- sell 40` | Sells 40 risk tokens into the pool |
| `npm run bot -- buy 5000` | Buys with 5000 stable tokens |
| `npm run bot -- restore 2040` | Moves the pool price back to a target |
| `npm run bot -- topup 10` | Mints risk tokens into the vault to refill the position |
| `npm run bot -- fund-reactive 0.3` | Sends 0.3 lREACT from your wallet to the reactive contract |
| `npm run bot -- fund-guard 0.001` | Sends 0.001 ETH from your wallet to the guard |
| `npm run trace -- 3 timeout` | Rebuilds the full trace for action 3 and saves it |
| `npm run report` | Writes `data/submission.md`: the newest trace per scenario with transaction hashes, plus a latency summary over every recorded action |
| `npm run notify` | Watches the guard and sends Telegram or webhook messages with a deep link |
| `npm run index` | Watches for resolved actions and records a trace for each |
| `npm run demo` | Runs the four scripted scenarios against the live network |
| `npm run rehearse` | Runs the same demo on two local chains with a simulated network |

Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NOTIFY_WEBHOOK_URL` and `APP_URL` to the contracts `.env` to enable the notifier targets. Without them it logs to the console.

## The latency trace

For each action the tracer matches three transactions by the trigger price, which appears in the pool `Sync` log, the reactive contract's `TriggerFired` event and the guard's `ActionOpened` event:

1. The origin swap on the pool chain.
2. The reactive transaction on the Reactive chain that detected it.
3. The callback transaction on the pool chain that opened the action.

From those it derives origin to reactive, reactive to callback, end to end, how much of the decision window is left for the user, and for timeouts the lag between the deadline and the default. Block timestamps have one second resolution, so each hop is accurate to about a second.

The trace also counts origin blocks between the swap and the action. Base Sepolia produces a block every 200ms, so that count gives a sub-second estimate that whole-second timestamps cannot (the estimate assumes 200ms per block and the table states it).

The reactive chain and the origin chain stamp blocks with different clocks, so the reactive hop can appear one second early. It is then shown as 0s with the difference taken out of the callback hop, and the table says so. End to end is measured on the origin chain alone and is not affected.

Results are written to `data/traces.json` and `data/latency.md`.

`data/latency.md` lists every recorded action, including reruns. For a clean table with one row per scenario, run `npm run report`.

Blocks are located by timestamp, so every log query covers a few seconds of blocks. Queries are also split into chunks of at most `LOG_RANGE` blocks (default 150), because the public Base Sepolia RPC rejects `eth_getLogs` ranges above 200 blocks. If a run ends on chain but the trace step fails, rebuild it without spending anything with `npm run trace -- <actionId> <scenario>`.

## Demo scenarios

`npm run demo` runs `approve`, `veto`, `timeout` and `recover` in order. Choose others with `--only`, for example `npm run demo -- --only approve,escalate --yes`. Available: `approve`, `resize`, `veto`, `timeout`, `recover`, `escalate`.

Each scenario prepares a clean state first. It tops up the vault, restores the price to 2040, waits for the reactive contract to observe it and re-arm the stop trigger, waits out the cooldown, then sells enough to force a gap.

Polling steps keep retrying through network failures until their timeout, and RPC calls retry with backoff for about 30 seconds, so a brief wifi drop does not end a run. Transactions are never retried blindly. If a run does stop, rerun the demo: every scenario starts by restoring a clean state.

Budget about 0.15 to 0.25 lREACT per scenario at current Lasna gas prices. The runner prints the contract balance before it starts and what each scenario spent.

## Rehearsing for free

```
npm run rehearse
```

This needs `anvil`, `forge` and `cast` on your path. It starts two local chains, deploys a copy of the contracts into a temporary directory with short windows, runs a simulator that relays events and callbacks the way the Reactive network does, runs all four scenarios, and prints the table. Your real `deployments/` and `data/` folders are never touched. The timings it prints are not representative because the simulator polls.
