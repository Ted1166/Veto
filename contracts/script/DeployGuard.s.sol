// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {IPayable} from "reactive-lib/interfaces/IPayable.sol";
import {HeadsUpGuard} from "../src/HeadsUpGuard.sol";
import {PositionVault} from "../src/fixtures/PositionVault.sol";

contract DeployGuard is Script {
    address private constant BASE_SEPOLIA_PROXY =
        0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    address private constant UNICHAIN_SEPOLIA_PROXY =
        0x775c9B990ADe401060B78D0e98684eEf8d2466C1;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address reactiveAddress = vm.envAddress("REACTIVE_ADDRESS");
        address proxy = vm.envOr("CALLBACK_PROXY", _defaultProxy());

        uint16 reduceBps = uint16(vm.envOr("REDUCE_BPS", uint256(5_000)));
        uint64 decisionWindow = uint64(
            vm.envOr("DECISION_WINDOW", uint256(60))
        );
        uint64 escalatedWindow = uint64(
            vm.envOr("ESCALATED_WINDOW", uint256(15))
        );
        uint256 funding = vm.envOr("GUARD_FUNDING", uint256(0.01 ether));

        string memory fixtures = vm.readFile("./deployments/fixtures.json");
        PositionVault vault = PositionVault(
            vm.parseJsonAddress(fixtures, ".vault")
        );

        require(vault.owner() == deployer, "deployer must own the vault");
        require(proxy != address(0), "callback proxy required");

        vm.startBroadcast(deployerKey);
        HeadsUpGuard guard = new HeadsUpGuard{value: funding}(
            IPayable(payable(proxy)),
            reactiveAddress,
            vault,
            reduceBps,
            decisionWindow,
            escalatedWindow
        );
        vault.setGuard(address(guard));
        vm.stopBroadcast();

        vm.createDir("./deployments", true);

        string memory key = "guard";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "callbackProxy", proxy);
        vm.serializeAddress(key, "reactive", reactiveAddress);
        vm.serializeAddress(key, "vault", address(vault));
        vm.serializeUint(key, "decisionWindow", decisionWindow);
        vm.serializeUint(key, "escalatedWindow", escalatedWindow);
        string memory json = vm.serializeAddress(key, "guard", address(guard));
        vm.writeJson(json, "./deployments/guard.json");

        console2.log("guard", address(guard));
    }

    function _defaultProxy() private view returns (address) {
        if (block.chainid == 84532) return BASE_SEPOLIA_PROXY;
        if (block.chainid == 1301) return UNICHAIN_SEPOLIA_PROXY;
        return address(0);
    }
}
