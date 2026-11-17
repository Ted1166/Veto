#!/usr/bin/env bash
set -euo pipefail

backend="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$backend/.." && pwd)"
work="$(mktemp -d)"

key=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
a_port=18545
b_port=18546
a_url="http://127.0.0.1:$a_port"
b_url="http://127.0.0.1:$b_port"

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  if [ "${REHEARSE_KEEP:-0}" = "1" ]; then
    echo "kept $work"
  else
    rm -rf "$work"
  fi
}
trap cleanup EXIT

export FOUNDRY_NO_STORAGE_CACHING=true

anvil --chain-id 84532 -p "$a_port" --silent &
pids+=($!)
anvil --chain-id 5318008 -p "$b_port" --silent &
pids+=($!)
sleep 2

mkdir -p "$work/contracts" "$work/data"
(cd "$root/contracts" && tar --exclude=./lib --exclude=./out --exclude=./cache --exclude=./broadcast --exclude=./deployments --exclude=./.env -cf - .) | (cd "$work/contracts" && tar -xf -)
ln -s "$root/contracts/lib" "$work/contracts/lib"

code=$(cd "$work/contracts" && forge inspect MockSystemContract deployedBytecode)
cast rpc anvil_setCode 0x8888888888888888888888888888888888888888 "$code" --rpc-url "$b_url" >/dev/null
cast rpc anvil_setCode 0x476F44b11F5C942c58f4c8E3d0300E5710743585 "$code" --rpc-url "$a_url" >/dev/null

cat > "$work/contracts/.env" <<ENV
PRIVATE_KEY=$key
BASE_SEPOLIA_RPC_URL=$a_url
REACTIVE_RPC_URL=$b_url
ORIGIN_CHAIN_ID=84532
DECISION_WINDOW=14
ESCALATED_WINDOW=6
COOLDOWN=10
REQUEST_TIMEOUT=8
TICK_INTERVAL=1
GUARD_FUNDING=10000000000000000
REACTIVE_FUNDING=100000000000000000
ENV

echo "deploying to local chains"
bash "$work/contracts/scripts/deploy-all.sh" > "$work/deploy.log" 2>&1 || { cat "$work/deploy.log"; exit 1; }
grep -E "^\s+(guard|reactive|pool|vault)\s" "$work/deploy.log" || true

export HEADS_UP_ENV="$work/contracts/.env"
export DEPLOYMENTS_DIR="$work/contracts/deployments"
export DATA_DIR="$work/data"

cd "$backend"
node --import tsx scripts/networkSim.ts > "$work/sim.log" 2>&1 &
pids+=($!)
sleep 2

scenarios="${REHEARSE_SCENARIOS:-approve,veto,timeout,recover}"
echo "running scenarios: $scenarios"
node --import tsx scripts/runDemo.ts --only "$scenarios" --yes

echo
echo "latency table written to $DATA_DIR/latency.md (simulated network, timings are not representative)"
if [ "${REHEARSE_KEEP:-0}" = "1" ]; then
  cp "$work/sim.log" "$backend/data/rehearsal-sim.log"
fi
