# Architecture

## Components

| Contract | Runs on | Role |
| --- | --- | --- |
| `HeadsUpReactive` | Reactive Lasna | Subscribes to pool `Sync` events, the guard's events and network cron ticks. Decides, and asks for callbacks. |
| `HeadsUpGuard` | Base Sepolia | Callback target. Holds the pending-action state machine and executes reductions through the vault. |
| `PositionVault` | Base Sepolia | Holds the risk token. Only the guard can reduce it. The owner can withdraw. |
| `MiniPool` | Base Sepolia | Constant product pool with V2 compatible events. Test fixture. |

## State machine (guard)

An action moves from `Pending` to exactly one end state.

| From | Trigger | To |
| --- | --- | --- |
| none | `openAction` callback from the reactive contract | Pending |
| Pending | `approve` by the owner before the deadline | Approved |
| Pending | `resize` by the owner before the deadline | Resized |
| Pending | `veto` by the owner before the deadline | Vetoed |
| Pending | `cancelOnRecovery` callback | Cancelled |
| Pending | `escalate` callback | Pending, proposing a full exit with a shorter deadline |
| Pending | `defaultFromReactive` callback or `executeDefault` after the deadline | Defaulted |

Owner decisions are only accepted before the deadline. After it, only the default can execute.

## What the reactive contract tracks

It keeps `lastPrice`, whether an action is pending and its anchor price and deadline, a cooldown, whether the stop-loss trigger is armed, and whether it is subscribed to cron ticks. Pool events drive detection and supervision. Guard events keep its view of the pending action in sync. Cron ticks drive the timeout.

## Trust model

- Every callback entry point on the guard checks two things: the caller is the callback proxy, and the injected reactive address is the one fixed at deploy time.
- The reactive contract ignores any log that does not match its chain, emitter, topic and `opCode`, rather than reverting, because reverts are still billed.
- Deployment breaks the circular reference (guard needs the reactive address, reactive needs the guard address) by predicting the reactive address from the deployer nonce and asserting it at deploy time.

## Cost model

Each reactive transaction costs gas used plus a fixed surcharge, at the Lasna gas price. Measured on the live network, a typical scenario cost about 0.045 to 0.07 lREACT and a timeout about 0.13 to 0.15 because of the cron ticks. The guard pays for callbacks in Base Sepolia ETH, which is a tiny amount.

## How the latency is measured

The tracer matches three transactions by the trigger price, which appears in the pool `Sync` log, the reactive `TriggerFired` event and the guard's `ActionOpened` event. Blocks are located by timestamp so every log query covers a few seconds of blocks. See `backend/src/lib/trace.ts`.
