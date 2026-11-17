// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {HeadsUpReactive} from "../src/HeadsUpReactive.sol";
import {CronTopics} from "../src/libraries/CronTopics.sol";

contract DeployReactive is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address expected = vm.envAddress("REACTIVE_ADDRESS");
        uint256 funding = vm.envOr("REACTIVE_FUNDING", uint256(0.4 ether));

        string memory fixtures = vm.readFile("./deployments/fixtures.json");
        string memory guardFile = vm.readFile("./deployments/guard.json");

        HeadsUpReactive.Config memory config = HeadsUpReactive.Config({
            chainId: vm.envOr("ORIGIN_CHAIN_ID", uint256(84532)),
            pool: vm.parseJsonAddress(fixtures, ".pool"),
            guard: vm.parseJsonAddress(guardFile, ".guard"),
            riskIsToken0: vm.envOr("RISK_IS_TOKEN0", true),
            stopPrice: vm.envOr("STOP_PRICE", uint256(1_900 ether)),
            stopProximityBps: uint16(
                vm.envOr("STOP_PROXIMITY_BPS", uint256(200))
            ),
            gapBps: uint16(vm.envOr("GAP_BPS", uint256(500))),
            recoverBps: uint16(vm.envOr("RECOVER_BPS", uint256(300))),
            escalateBps: uint16(vm.envOr("ESCALATE_BPS", uint256(500))),
            rearmBps: uint16(vm.envOr("REARM_BPS", uint256(300))),
            cooldown: uint64(vm.envOr("COOLDOWN", uint256(120))),
            requestTimeout: uint64(vm.envOr("REQUEST_TIMEOUT", uint256(30))),
            callbackGas: uint64(vm.envOr("CALLBACK_GAS", uint256(500_000))),
            tickTopic: _tickTopic(vm.envOr("TICK_INTERVAL", uint256(1)))
        });

        vm.startBroadcast(deployerKey);
        HeadsUpReactive reactive = new HeadsUpReactive{value: funding}(config);
        vm.stopBroadcast();

        require(
            address(reactive) == expected,
            "reactive address differs from prediction"
        );

        vm.createDir("./deployments", true);

        string memory key = "reactive";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "originChainId", config.chainId);
        vm.serializeAddress(key, "pool", config.pool);
        vm.serializeAddress(key, "guard", config.guard);
        string memory json = vm.serializeAddress(
            key,
            "reactive",
            address(reactive)
        );
        vm.writeJson(json, "./deployments/reactive.json");

        console2.log("reactive", address(reactive));
    }

    function _tickTopic(uint256 interval) private pure returns (uint256) {
        if (interval == 0) return 0;
        if (interval == 1) return CronTopics.CRON_1;
        if (interval == 10) return CronTopics.CRON_10;
        if (interval == 100) return CronTopics.CRON_100;
        if (interval == 1_000) return CronTopics.CRON_1000;
        if (interval == 10_000) return CronTopics.CRON_10000;
        revert("TICK_INTERVAL must be 0, 1, 10, 100, 1000 or 10000");
    }
}
