#!/usr/bin/env bash
set -uo pipefail

: "${BASE_SEPOLIA_RPC_URL:?}"
: "${REACTIVE_RPC_URL:?}"

SYSTEM_CONTRACT=0x8888888888888888888888888888888888888888
GUARD=$(jq -r .guard deployments/guard.json)
PROXY=$(jq -r .callbackProxy deployments/guard.json)
VAULT=$(jq -r .vault deployments/fixtures.json)
REACTIVE=$(jq -r .reactive deployments/reactive.json)

failed=0

check() {
  local label=$1 actual=$2 expected=$3
  if [ "${actual,,}" = "${expected,,}" ]; then
    printf 'ok        %s\n' "$label"
  else
    printf 'MISMATCH  %s\n          expected %s\n          actual   %s\n' "$label" "$expected" "$actual"
    failed=1
  fi
}

call() {
  cast call "$1" "$2" "${@:4}" --rpc-url "$3" 2>/dev/null | awk '{print $1}'
}

check "guard service provider is the callback proxy" "$(call "$GUARD" '_SERVICE_PROVIDER()(address)' "$BASE_SEPOLIA_RPC_URL")" "$PROXY"
check "guard trusts the reactive contract" "$(call "$GUARD" '_CALLBACK_SENDER()(address)' "$BASE_SEPOLIA_RPC_URL")" "$REACTIVE"
check "vault trusts the guard" "$(call "$VAULT" 'guard()(address)' "$BASE_SEPOLIA_RPC_URL")" "$GUARD"
check "reactive service provider is the system contract" "$(call "$REACTIVE" '_SERVICE_PROVIDER()(address)' "$REACTIVE_RPC_URL")" "$SYSTEM_CONTRACT"
check "reactive points at the guard" "$(call "$REACTIVE" 'GUARD()(address)' "$REACTIVE_RPC_URL")" "$GUARD"

echo
echo "guard balance      $(cast balance "$GUARD" --rpc-url "$BASE_SEPOLIA_RPC_URL")"
echo "guard debt         $(call "$PROXY" 'debt(address)(uint256)' "$BASE_SEPOLIA_RPC_URL" "$GUARD")"
echo "guard reserves     $(call "$PROXY" 'reserves(address)(uint256)' "$BASE_SEPOLIA_RPC_URL" "$GUARD")"
echo "reactive balance   $(cast balance "$REACTIVE" --rpc-url "$REACTIVE_RPC_URL")"
echo "reactive debt      $(call "$SYSTEM_CONTRACT" 'debt(address)(uint256)' "$REACTIVE_RPC_URL" "$REACTIVE")"
echo "reactive reserves  $(call "$SYSTEM_CONTRACT" 'reserves(address)(uint256)' "$REACTIVE_RPC_URL" "$REACTIVE")"
echo

filters_of() {
  jq '(.result.TopicFilters // .result.topicFilters)'
}

count_subscriptions() {
  jq --arg reactive "${REACTIVE,,}" '
    (.result.TopicFilters // .result.topicFilters // [])
    | [ .[] | select(any((.Configs // [])[]?; ((.Contract // "") | ascii_downcase) == $reactive and .Active == true)) ]
    | length'
}

filters=$(curl -s -X POST "$REACTIVE_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"rnk_getFilters","params":[],"id":1}')

if echo "$filters" | filters_of >/dev/null 2>&1 && [ "$(echo "$filters" | filters_of)" != "null" ]; then
  active=$(echo "$filters" | count_subscriptions)
  check "active subscriptions for the reactive contract" "$active" "4"
else
  echo "skipped   rnk_getFilters is not available on this endpoint"
fi

exit $failed
