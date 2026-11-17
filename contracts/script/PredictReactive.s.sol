// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";

contract PredictReactive is Script {
    function run() external view {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        uint64 nonce = vm.getNonce(deployer);
        console2.log("deployer", deployer);
        console2.log("nonce   ", nonce);
        console2.log("reactive", vm.computeCreateAddress(deployer, nonce));
    }
}
