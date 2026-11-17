#!/usr/bin/env bash
set -euo pipefail

forge install --no-git \
  foundry-rs/forge-std@v1.17.0 \
  OpenZeppelin/openzeppelin-contracts@v5.1.0 \
  Reactive-Network/reactive-lib-omni@v0.1.0
