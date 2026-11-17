#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

resume=0
if [ "${1:-}" = "--resume" ]; then
  resume=1
fi

if [ ! -f .env ]; then
  echo ".env not found in $(pwd)"
  exit 1
fi

set -a
source .env
set +a

: "${PRIVATE_KEY:?}"
: "${BASE_SEPOLIA_RPC_URL:?}"
: "${REACTIVE_RPC_URL:?}"

deployer=$(cast wallet address --private-key "$PRIVATE_KEY")
funding=${REACTIVE_FUNDING:-400000000000000000}
gas_reserve=500000000000000000

lreact=$(cast balance "$deployer" --rpc-url "$REACTIVE_RPC_URL")
base_eth=$(cast balance "$deployer" --rpc-url "$BASE_SEPOLIA_RPC_URL")

echo "deployer        $deployer"
echo "reactive chain  $lreact wei"
echo "base sepolia    $base_eth wei"

need=$(awk -v f="$funding" -v g="$gas_reserve" 'BEGIN { printf "%.0f", f + g }')

if awk -v have="$lreact" -v need="$need" 'BEGIN { exit !(have + 0 < need + 0) }'; then
  echo "not enough on the reactive chain: need at least $need wei (funding plus the gas the node reserves up front)"
  echo "lower REACTIVE_FUNDING in .env or get more lREACT from the faucet"
  exit 1
fi

run() {
  local label=$1
  shift
  echo
  echo "== $label"
  local output
  if ! output=$("$@" 2>&1); then
    printf '%s\n' "$output"
    echo "failed: $label"
    exit 1
  fi
  printf '%s\n' "$output" | grep -E "^\s+(riskToken|stableToken|pool|vault|guard|reactive)\s" || true
}

if [ "$resume" = "1" ]; then
  if [ ! -f deployments/guard.json ] || [ ! -f deployments/fixtures.json ]; then
    echo "nothing to resume: deployments/fixtures.json or guard.json is missing"
    exit 1
  fi
  predicted=$(forge script script/PredictReactive.s.sol --rpc-url "$REACTIVE_RPC_URL" 2>&1 | awk '/^ *reactive / {print $2}')
  if [ "${REACTIVE_ADDRESS:-}" != "$predicted" ]; then
    echo "the deployer nonce on the reactive chain has moved, so the guard no longer matches"
    echo "expected $REACTIVE_ADDRESS but the next deployment would be $predicted"
    echo "run without --resume to redeploy everything"
    exit 1
  fi
  echo
  echo "== resuming at the reactive contract, guard $(jq -r .guard deployments/guard.json)"
else
  if ls deployments/*.json >/dev/null 2>&1; then
    stamp=$(date +%Y%m%d-%H%M%S)
    mkdir -p "deployments/archive/$stamp"
    cp deployments/*.json "deployments/archive/$stamp/"
    echo "previous deployment archived in deployments/archive/$stamp"
  fi

  run "1/5 fixtures on the origin chain" \
    forge script script/DeployFixtures.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast

  predicted=$(forge script script/PredictReactive.s.sol --rpc-url "$REACTIVE_RPC_URL" 2>&1 | awk '/^ *reactive / {print $2}')
  if ! [[ "$predicted" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "could not read the predicted reactive address"
    exit 1
  fi

  if grep -q '^REACTIVE_ADDRESS=' .env; then
    sed -i "s|^REACTIVE_ADDRESS=.*|REACTIVE_ADDRESS=$predicted|" .env
  else
    echo "REACTIVE_ADDRESS=$predicted" >> .env
  fi
  export REACTIVE_ADDRESS=$predicted
  echo
  echo "== 2/5 predicted reactive address $predicted (written to .env)"

  run "3/5 guard on the origin chain" \
    forge script script/DeployGuard.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
fi

run "4/5 reactive contract" \
  forge script script/DeployReactive.s.sol --rpc-url "$REACTIVE_RPC_URL" --broadcast

echo
echo "== 5/5 deployment check"
bash scripts/check-deployment.sh
