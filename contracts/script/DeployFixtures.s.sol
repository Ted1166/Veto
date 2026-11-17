// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {MockToken} from "../src/fixtures/MockToken.sol";
import {MiniPool} from "../src/fixtures/MiniPool.sol";
import {PositionVault} from "../src/fixtures/PositionVault.sol";

contract DeployFixtures is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        uint256 poolRisk = vm.envOr("POOL_RISK", uint256(1_000 ether));
        uint256 poolStable = vm.envOr("POOL_STABLE", uint256(2_000_000 ether));
        uint256 positionRisk = vm.envOr("POSITION_RISK", uint256(10 ether));

        vm.startBroadcast(deployerKey);

        MockToken risk = new MockToken("Heads-Up Risk Asset", "HRISK");
        MockToken stable = new MockToken("Heads-Up Stable", "HUSD");
        MiniPool pool = new MiniPool(risk, stable);

        risk.mint(deployer, poolRisk);
        stable.mint(deployer, poolStable);
        risk.approve(address(pool), poolRisk);
        stable.approve(address(pool), poolStable);
        pool.seed(poolRisk, poolStable);

        PositionVault vault = new PositionVault(deployer, pool, risk, stable);
        risk.mint(address(vault), positionRisk);

        vm.stopBroadcast();

        string memory key = "fixtures";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "riskToken", address(risk));
        vm.serializeAddress(key, "stableToken", address(stable));
        vm.serializeAddress(key, "pool", address(pool));
        string memory json = vm.serializeAddress(key, "vault", address(vault));
        vm.writeJson(json, "./deployments/fixtures.json");

        console2.log("riskToken ", address(risk));
        console2.log("stableToken", address(stable));
        console2.log("pool      ", address(pool));
        console2.log("vault     ", address(vault));
    }
}
