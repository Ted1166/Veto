// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";
import {MockToken} from "../../src/fixtures/MockToken.sol";
import {MiniPool} from "../../src/fixtures/MiniPool.sol";
import {PositionVault} from "../../src/fixtures/PositionVault.sol";
import {HeadsUpGuard} from "../../src/HeadsUpGuard.sol";
import {HeadsUpReactive} from "../../src/HeadsUpReactive.sol";
import {CronTopics} from "../../src/libraries/CronTopics.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

abstract contract Harness is Test {
    address internal constant SYSTEM_ADDRESS =
        0x8888888888888888888888888888888888888888;
    address internal constant CALLBACK_PROXY = address(0xCA11BAC);

    uint256 internal constant CRON_1_TOPIC = CronTopics.CRON_1;
    address internal constant CRON_SOURCE = CronTopics.SOURCE;

    uint256 internal constant POOL_RISK = 1_000 ether;
    uint256 internal constant POOL_STABLE = 2_000_000 ether;
    uint256 internal constant VAULT_RISK = 10 ether;

    uint64 internal constant DECISION_WINDOW = 60;
    uint64 internal constant ESCALATED_WINDOW = 15;
    uint64 internal constant COOLDOWN = 120;
    uint64 internal constant REQUEST_TIMEOUT = 30;
    uint16 internal constant REDUCE_BPS = 5_000;

    address internal owner = makeAddr("owner");
    address internal trader = makeAddr("trader");
    address internal stranger = makeAddr("stranger");

    MockToken internal risk;
    MockToken internal stable;
    MiniPool internal pool;
    PositionVault internal vault;
    HeadsUpGuard internal guard;
    HeadsUpReactive internal reactive;
    MockSystemContract internal system;

    function _deployStack() internal {
        vm.etch(SYSTEM_ADDRESS, address(new MockSystemContract()).code);
        vm.etch(CALLBACK_PROXY, address(new MockSystemContract()).code);
        system = MockSystemContract(payable(SYSTEM_ADDRESS));

        risk = new MockToken("Risk", "RSK");
        stable = new MockToken("Stable", "STB");
        pool = new MiniPool(risk, stable);

        risk.mint(address(this), POOL_RISK);
        stable.mint(address(this), POOL_STABLE);
        risk.approve(address(pool), POOL_RISK);
        stable.approve(address(pool), POOL_STABLE);
        pool.seed(POOL_RISK, POOL_STABLE);

        vault = new PositionVault(owner, pool, risk, stable);
        risk.mint(address(vault), VAULT_RISK);

        risk.mint(trader, 1_000_000 ether);
        stable.mint(trader, 1_000_000_000 ether);
        vm.startPrank(trader);
        risk.approve(address(pool), type(uint256).max);
        stable.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _deployGuard(address reactiveAddress) internal {
        guard = new HeadsUpGuard(
            MockSystemContract(payable(CALLBACK_PROXY)),
            reactiveAddress,
            vault,
            REDUCE_BPS,
            DECISION_WINDOW,
            ESCALATED_WINDOW
        );
        vm.prank(owner);
        vault.setGuard(address(guard));
    }

    function _defaultConfig()
        internal
        view
        returns (HeadsUpReactive.Config memory)
    {
        return
            HeadsUpReactive.Config({
                chainId: block.chainid,
                pool: address(pool),
                guard: address(guard),
                riskIsToken0: true,
                stopPrice: 1_900 ether,
                stopProximityBps: 200,
                gapBps: 500,
                recoverBps: 300,
                escalateBps: 500,
                rearmBps: 300,
                cooldown: COOLDOWN,
                requestTimeout: REQUEST_TIMEOUT,
                callbackGas: 500_000,
                tickTopic: CRON_1_TOPIC
            });
    }

    function _deployFullStack() internal {
        _deployStack();
        address predicted = vm.computeCreateAddress(
            address(this),
            vm.getNonce(address(this)) + 1
        );
        _deployGuard(predicted);
        reactive = new HeadsUpReactive(_defaultConfig());
        assertEq(address(reactive), predicted);
    }

    function _sell(uint256 amount) internal returns (uint256) {
        vm.prank(trader);
        return pool.swap(address(risk), amount, 0, trader);
    }

    function _buy(uint256 amount) internal returns (uint256) {
        vm.prank(trader);
        return pool.swap(address(stable), amount, 0, trader);
    }

    function _toRecord(
        Vm.Log memory entry
    ) internal view returns (IReactive.LogRecord memory) {
        return
            IReactive.LogRecord({
                chainId: block.chainid,
                contractAddress: entry.emitter,
                topic0: entry.topics.length > 0 ? uint256(entry.topics[0]) : 0,
                topic1: entry.topics.length > 1 ? uint256(entry.topics[1]) : 0,
                topic2: entry.topics.length > 2 ? uint256(entry.topics[2]) : 0,
                topic3: entry.topics.length > 3 ? uint256(entry.topics[3]) : 0,
                data: entry.data,
                blockNumber: block.number,
                opCode: entry.topics.length,
                blockHash: 0,
                txHash: 0,
                logIndex: 0
            });
    }

    function _relay() internal {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        for (uint256 i = 0; i < entries.length; i++) {
            address emitter = entries[i].emitter;
            if (emitter != address(pool) && emitter != address(guard)) continue;
            IReactive.LogRecord memory record = _toRecord(entries[i]);
            vm.prank(SYSTEM_ADDRESS);
            reactive.react(record);
        }
    }

    function _deliver(uint256 index) internal returns (bool success) {
        ISystemContract.CallbackConfiguration_V_1_0 memory callback = system
            .callbackAt(index);
        bytes memory payload = callback.payload;
        bytes memory patched = new bytes(payload.length);
        for (uint256 i = 0; i < payload.length; i++) {
            patched[i] = payload[i];
        }
        bytes32 sender = bytes32(uint256(uint160(address(reactive))));
        for (uint256 i = 0; i < 32; i++) {
            patched[4 + i] = sender[i];
        }
        vm.prank(CALLBACK_PROXY);
        (success, ) = callback.recipient.call(patched);
    }

    function _deliverAll(uint256 fromIndex) internal returns (uint256 next) {
        next = system.callbackCount();
        for (uint256 i = fromIndex; i < next; i++) {
            _deliver(i);
        }
    }

    function _prime() internal {
        vm.recordLogs();
        _buy(1_000 ether);
        _relay();
    }

    function _openPending() internal returns (uint256 id) {
        uint256 callbacks = system.callbackCount();
        _sell(40 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks + 1);
        assertTrue(_deliver(callbacks));
        _relay();
        id = guard.activeActionId();
    }

    function _args(
        bytes memory payload
    ) internal pure returns (bytes memory args) {
        args = new bytes(payload.length - 4);
        for (uint256 i = 0; i < args.length; i++) {
            args[i] = payload[i + 4];
        }
    }

    function _selectorOf(bytes memory payload) internal pure returns (bytes4) {
        return bytes4(payload);
    }
}
