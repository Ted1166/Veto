// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";
import {AbstractPayer} from "reactive-lib/base/AbstractPayer.sol";
import {Harness} from "./utils/Harness.sol";
import {HeadsUpReactive} from "../src/HeadsUpReactive.sol";
import {IHeadsUpGuard} from "../src/interfaces/IHeadsUpGuard.sol";
import {CronTopics} from "../src/libraries/CronTopics.sol";
import {MiniPool} from "../src/fixtures/MiniPool.sol";
import {MockSystemContract} from "./mocks/MockSystemContract.sol";

contract HeadsUpReactiveTest is Harness {
    function setUp() public {
        _deployFullStack();
        _prime();
    }

    function _lastCallback()
        internal
        view
        returns (ISystemContract.CallbackConfiguration_V_1_0 memory)
    {
        return system.callbackAt(system.callbackCount() - 1);
    }

    function _record(
        address emitter,
        uint256 topic0,
        uint256 topic1,
        bytes memory data,
        uint256 chainId
    ) internal view returns (IReactive.LogRecord memory) {
        return _record(emitter, topic0, topic1, data, chainId, 1);
    }

    function _record(
        address emitter,
        uint256 topic0,
        uint256 topic1,
        bytes memory data,
        uint256 chainId,
        uint256 opCode
    ) internal view returns (IReactive.LogRecord memory) {
        return
            IReactive.LogRecord({
                chainId: chainId,
                contractAddress: emitter,
                topic0: topic0,
                topic1: topic1,
                topic2: 0,
                topic3: 0,
                data: data,
                blockNumber: block.number,
                opCode: opCode,
                blockHash: 0,
                txHash: 0,
                logIndex: 0
            });
    }

    function _tick(uint256 topic) internal {
        IReactive.LogRecord memory record = _record(
            CRON_SOURCE,
            topic,
            0,
            abi.encode(block.number),
            block.chainid,
            1
        );
        vm.prank(SYSTEM_ADDRESS);
        reactive.react(record);
    }

    function test_constructorSubscribesToPoolAndGuardEvents() public view {
        assertEq(system.subscriptionCount(), 4);

        MockSystemContract.Subscription memory sync = system.subscriptionAt(0);
        assertEq(sync.subscriber, address(reactive));
        assertEq(sync.chainId, block.chainid);
        assertEq(sync.target, address(pool));
        assertEq(sync.topic0, uint256(keccak256("Sync(uint112,uint112)")));

        MockSystemContract.Subscription memory opened = system.subscriptionAt(
            1
        );
        MockSystemContract.Subscription memory escalated = system
            .subscriptionAt(2);
        MockSystemContract.Subscription memory resolved = system.subscriptionAt(
            3
        );
        assertEq(opened.target, address(guard));
        assertEq(escalated.target, address(guard));
        assertEq(resolved.target, address(guard));
        assertEq(opened.topic0, uint256(IHeadsUpGuard.ActionOpened.selector));
        assertEq(
            escalated.topic0,
            uint256(IHeadsUpGuard.ActionEscalated.selector)
        );
        assertEq(
            resolved.topic0,
            uint256(IHeadsUpGuard.ActionResolved.selector)
        );
    }

    function test_constructorRejectsInvalidConfig() public {
        HeadsUpReactive.Config memory config = _defaultConfig();

        config.pool = address(0);
        vm.expectRevert(HeadsUpReactive.InvalidConfig.selector);
        new HeadsUpReactive(config);

        config = _defaultConfig();
        config.stopPrice = 0;
        vm.expectRevert(HeadsUpReactive.InvalidConfig.selector);
        new HeadsUpReactive(config);

        config = _defaultConfig();
        config.gapBps = 0;
        vm.expectRevert(HeadsUpReactive.InvalidConfig.selector);
        new HeadsUpReactive(config);

        config = _defaultConfig();
        config.escalateBps = 10_000;
        vm.expectRevert(HeadsUpReactive.InvalidConfig.selector);
        new HeadsUpReactive(config);

        config = _defaultConfig();
        config.requestTimeout = 0;
        vm.expectRevert(HeadsUpReactive.InvalidConfig.selector);
        new HeadsUpReactive(config);
    }

    function test_reactIsRestrictedToSystemContract() public {
        IReactive.LogRecord memory record = _record(
            address(pool),
            uint256(keccak256("Sync(uint112,uint112)")),
            0,
            "",
            block.chainid
        );
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                AbstractPayer.NotAuthorized.selector,
                stranger,
                SYSTEM_ADDRESS
            )
        );
        reactive.react(record);
    }

    function test_ignoresLogsFromOtherChainsAndEmitters() public {
        bytes memory data = abi.encode(
            uint112(1_000 ether),
            uint112(1_000_000 ether)
        );
        uint256 syncTopic = uint256(keccak256("Sync(uint112,uint112)"));

        vm.startPrank(SYSTEM_ADDRESS);
        reactive.react(
            _record(address(pool), syncTopic, 0, data, block.chainid + 1)
        );
        reactive.react(_record(stranger, syncTopic, 0, data, block.chainid));
        vm.stopPrank();

        assertEq(system.callbackCount(), 0);
    }

    function test_smallMovesDoNotTrigger() public {
        _sell(5 ether);
        _relay();
        assertEq(system.callbackCount(), 0);
    }

    function test_priceGapRequestsOpenAction() public {
        _sell(40 ether);
        _relay();

        assertEq(system.callbackCount(), 1);
        ISystemContract.CallbackConfiguration_V_1_0
            memory callback = _lastCallback();
        assertEq(callback.recipient, address(guard));
        assertEq(callback.chainId, block.chainid);
        assertEq(callback.gasLimit, 500_000);
        assertEq(
            _selectorOf(callback.payload),
            IHeadsUpGuard.openAction.selector
        );

        (, IHeadsUpGuard.Trigger trigger, uint256 price) = abi.decode(
            _args(callback.payload),
            (address, IHeadsUpGuard.Trigger, uint256)
        );
        assertEq(uint8(trigger), uint8(IHeadsUpGuard.Trigger.PriceGap));
        assertEq(price, pool.spotPrice());
    }

    function test_stopProximityRequestsOpenAction() public {
        _sell(20 ether);
        _relay();

        assertEq(system.callbackCount(), 1);
        (, IHeadsUpGuard.Trigger trigger, uint256 price) = abi.decode(
            _args(_lastCallback().payload),
            (address, IHeadsUpGuard.Trigger, uint256)
        );
        assertEq(
            uint8(trigger),
            uint8(IHeadsUpGuard.Trigger.StopLossProximity)
        );
        assertLe(price, (1_900 ether * 10_200) / 10_000);
    }

    function test_inFlightRequestIsNotDuplicated() public {
        _sell(40 ether);
        _relay();
        _sell(5 ether);
        _relay();
        assertEq(system.callbackCount(), 1);

        vm.warp(block.timestamp + REQUEST_TIMEOUT);
        _sell(5 ether);
        _relay();
        assertEq(system.callbackCount(), 2);
    }

    function test_openedActionIsTrackedFromGuardEvents() public {
        uint256 id = _openPending();
        IHeadsUpGuard.Action memory action = guard.getAction(id);

        assertTrue(reactive.pendingActive());
        assertEq(reactive.pendingId(), id);
        assertEq(reactive.anchorPrice(), action.triggerPrice);
        assertEq(reactive.pendingDeadline(), action.deadline);
        assertEq(reactive.openRequestedAt(), 0);
    }

    function test_recoveryCancelsPendingAction() public {
        uint256 id = _openPending();
        uint256 anchor = reactive.anchorPrice();
        uint256 callbacks = system.callbackCount();

        _buy(50_000 ether);
        _relay();
        assertGe(pool.spotPrice() * 10_000, anchor * 10_300);
        assertEq(system.callbackCount(), callbacks + 1);
        assertEq(
            _selectorOf(_lastCallback().payload),
            IHeadsUpGuard.cancelOnRecovery.selector
        );

        assertTrue(_deliver(callbacks));
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Cancelled)
        );
        assertEq(vault.riskBalance(), VAULT_RISK);
        assertFalse(reactive.pendingActive());
        assertEq(reactive.cooldownUntil(), uint64(block.timestamp) + COOLDOWN);
    }

    function test_cancelIsRequestedOnlyOnce() public {
        _openPending();
        uint256 callbacks = system.callbackCount();
        _buy(50_000 ether);
        _relay();
        _buy(1_000 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks + 1);
    }

    function test_furtherDropEscalatesPendingAction() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();

        _sell(40 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks + 1);
        assertEq(
            _selectorOf(_lastCallback().payload),
            IHeadsUpGuard.escalate.selector
        );

        assertTrue(_deliver(callbacks));
        _relay();

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertTrue(action.escalated);
        assertEq(action.proposedBps, 10_000);
        assertEq(reactive.pendingDeadline(), action.deadline);
        assertTrue(reactive.escalationSent());
    }

    function test_defaultIsExecutedThroughReactiveAfterDeadline() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();

        vm.warp(guard.getAction(id).deadline);
        _buy(1 ether);
        _relay();

        assertEq(system.callbackCount(), callbacks + 1);
        assertEq(
            _selectorOf(_lastCallback().payload),
            IHeadsUpGuard.defaultFromReactive.selector
        );

        assertTrue(_deliver(callbacks));
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Defaulted)
        );
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
        assertFalse(reactive.pendingActive());
    }

    function test_defaultRequestsAreThrottled() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();

        vm.warp(guard.getAction(id).deadline);
        _buy(1 ether);
        _relay();
        _buy(1 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks + 1);

        vm.warp(block.timestamp + 15);
        _buy(1 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks + 2);
    }

    function test_cooldownBlocksRetriggerAfterVeto() public {
        uint256 id = _openPending();
        vm.prank(owner);
        guard.veto(id);
        _relay();
        assertFalse(reactive.pendingActive());

        uint256 callbacks = system.callbackCount();
        _sell(40 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks);

        vm.warp(block.timestamp + COOLDOWN);
        _sell(40 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks + 1);
    }

    function test_staleTrackingClearsItself() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();
        vm.warp(guard.getAction(id).deadline + 601);

        _buy(1 ether);
        _relay();

        assertFalse(reactive.pendingActive());
        assertEq(system.callbackCount(), callbacks);
        assertEq(reactive.cooldownUntil(), uint64(block.timestamp) + COOLDOWN);
    }

    function test_firstObservationCanTriggerStopProximity() public {
        MiniPool inverted = new MiniPool(stable, risk);
        HeadsUpReactive.Config memory config = _defaultConfig();
        config.pool = address(inverted);
        config.riskIsToken0 = false;
        HeadsUpReactive fresh = new HeadsUpReactive(config);

        bytes memory data = abi.encode(
            uint112(1_800_000 ether),
            uint112(1_000 ether)
        );
        IReactive.LogRecord memory record = _record(
            address(inverted),
            uint256(keccak256("Sync(uint112,uint112)")),
            0,
            data,
            block.chainid
        );

        uint256 callbacks = system.callbackCount();
        vm.prank(SYSTEM_ADDRESS);
        fresh.react(record);

        assertEq(system.callbackCount(), callbacks + 1);
        (, IHeadsUpGuard.Trigger trigger, uint256 price) = abi.decode(
            _args(_lastCallback().payload),
            (address, IHeadsUpGuard.Trigger, uint256)
        );
        assertEq(
            uint8(trigger),
            uint8(IHeadsUpGuard.Trigger.StopLossProximity)
        );
        assertEq(price, 1_800 ether);
    }

    function test_coverDebtPaysTheSystemContract() public {
        system.setDebt(address(reactive), 1 ether);
        vm.deal(address(reactive), 2 ether);
        reactive.coverDebt();
        assertEq(SYSTEM_ADDRESS.balance, 1 ether);
    }

    function test_pendingActionStartsTicksAndResolutionStopsThem() public {
        assertEq(system.subscriptionCount(), 4);
        assertFalse(reactive.tickActive());

        uint256 id = _openPending();
        assertTrue(reactive.tickActive());
        assertEq(system.subscriptionCount(), 5);
        MockSystemContract.Subscription memory tick = system.subscriptionAt(4);
        assertEq(tick.target, CRON_SOURCE);
        assertEq(tick.topic0, CRON_1_TOPIC);
        assertEq(tick.chainId, block.chainid);
        assertEq(system.unsubscriptionCount(), 0);

        vm.prank(owner);
        guard.veto(id);
        _relay();

        assertFalse(reactive.tickActive());
        assertEq(system.unsubscriptionCount(), 1);
        MockSystemContract.Subscription memory stopped = system
            .unsubscriptionAt(0);
        assertEq(stopped.target, CRON_SOURCE);
        assertEq(stopped.topic0, CRON_1_TOPIC);
    }

    function test_tickAfterDeadlineExecutesDefaultWithoutPoolActivity() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();

        vm.warp(guard.getAction(id).deadline);
        _tick(CRON_1_TOPIC);

        assertEq(system.callbackCount(), callbacks + 1);
        assertEq(
            _selectorOf(_lastCallback().payload),
            IHeadsUpGuard.defaultFromReactive.selector
        );
        assertTrue(_deliver(callbacks));
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Defaulted)
        );
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
        assertFalse(reactive.pendingActive());
        assertFalse(reactive.tickActive());
    }

    function test_tickBeforeDeadlineDoesNothing() public {
        _openPending();
        uint256 callbacks = system.callbackCount();
        _tick(CRON_1_TOPIC);
        assertEq(system.callbackCount(), callbacks);
    }

    function test_tickRequestsAreThrottled() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();
        vm.warp(guard.getAction(id).deadline);

        _tick(CRON_1_TOPIC);
        _tick(CRON_1_TOPIC);
        assertEq(system.callbackCount(), callbacks + 1);

        vm.warp(block.timestamp + 15);
        _tick(CRON_1_TOPIC);
        assertEq(system.callbackCount(), callbacks + 2);
    }

    function test_tickWithoutPendingActionIsIgnored() public {
        uint256 callbacks = system.callbackCount();
        _tick(CRON_1_TOPIC);
        assertEq(system.callbackCount(), callbacks);
        assertEq(system.unsubscriptionCount(), 0);
    }

    function test_tickClearsStaleTracking() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();
        vm.warp(guard.getAction(id).deadline + 601);

        _tick(CRON_1_TOPIC);

        assertFalse(reactive.pendingActive());
        assertFalse(reactive.tickActive());
        assertEq(system.callbackCount(), callbacks);
        assertEq(system.unsubscriptionCount(), 1);
    }

    function test_unrelatedTickTopicIsIgnored() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();
        vm.warp(guard.getAction(id).deadline);
        _tick(CronTopics.CRON_10);
        assertEq(system.callbackCount(), callbacks);
    }

    function test_ticksCanBeDisabled() public {
        HeadsUpReactive.Config memory config = _defaultConfig();
        config.tickTopic = 0;
        HeadsUpReactive fresh = new HeadsUpReactive(config);

        uint256 subscriptions = system.subscriptionCount();
        bytes memory data = abi.encode(
            uint8(1),
            uint16(5_000),
            uint256(1_850 ether),
            uint64(block.timestamp + 60)
        );
        vm.prank(SYSTEM_ADDRESS);
        fresh.react(
            _record(
                address(guard),
                uint256(IHeadsUpGuard.ActionOpened.selector),
                1,
                data,
                block.chainid,
                2
            )
        );

        assertTrue(fresh.pendingActive());
        assertFalse(fresh.tickActive());
        assertEq(system.subscriptionCount(), subscriptions);
    }

    function test_constructorRejectsUnknownTickTopic() public {
        HeadsUpReactive.Config memory config = _defaultConfig();
        config.tickTopic = 1_234;
        vm.expectRevert(HeadsUpReactive.InvalidConfig.selector);
        new HeadsUpReactive(config);
    }

    function test_logsWithUnexpectedOpCodeAreIgnored() public {
        bytes memory reserves = abi.encode(
            uint112(1_000 ether),
            uint112(1_800_000 ether)
        );
        vm.prank(SYSTEM_ADDRESS);
        reactive.react(
            _record(
                address(pool),
                uint256(keccak256("Sync(uint112,uint112)")),
                0,
                reserves,
                block.chainid,
                3
            )
        );
        assertEq(system.callbackCount(), 0);

        bytes memory opened = abi.encode(
            uint8(1),
            uint16(5_000),
            uint256(1_850 ether),
            uint64(block.timestamp + 60)
        );
        vm.prank(SYSTEM_ADDRESS);
        reactive.react(
            _record(
                address(guard),
                uint256(IHeadsUpGuard.ActionOpened.selector),
                1,
                opened,
                block.chainid,
                1
            )
        );
        assertFalse(reactive.pendingActive());
    }

    function _openStopAction() internal returns (uint256 id) {
        uint256 callbacks = system.callbackCount();
        _sell(20 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks + 1);
        assertTrue(_deliver(callbacks));
        _relay();
        id = guard.activeActionId();
    }

    function _vetoAndWaitOutCooldown(uint256 id) internal {
        vm.prank(owner);
        guard.veto(id);
        _relay();
        vm.warp(block.timestamp + COOLDOWN);
    }

    function test_stopProximityFiresOncePerBreach() public {
        uint256 id = _openStopAction();
        assertTrue(reactive.stopDisarmed());
        uint256 callbacks = system.callbackCount();

        _vetoAndWaitOutCooldown(id);
        _sell(1 ether);
        _relay();
        _sell(1 ether);
        _relay();

        assertEq(system.callbackCount(), callbacks);
    }

    function test_stopRearmsAfterRecoveryAndFiresAgain() public {
        uint256 id = _openStopAction();
        _vetoAndWaitOutCooldown(id);
        uint256 callbacks = system.callbackCount();

        _buy(60_000 ether);
        _relay();
        assertFalse(reactive.stopDisarmed());
        assertEq(system.callbackCount(), callbacks);

        _sell(15 ether);
        _relay();
        assertEq(system.callbackCount(), callbacks);
        _sell(15 ether);
        _relay();

        assertEq(system.callbackCount(), callbacks + 1);
        (, IHeadsUpGuard.Trigger trigger, ) = abi.decode(
            _args(_lastCallback().payload),
            (address, IHeadsUpGuard.Trigger, uint256)
        );
        assertEq(
            uint8(trigger),
            uint8(IHeadsUpGuard.Trigger.StopLossProximity)
        );
    }

    function test_recoveryDuringPendingRearmsStopAndCancels() public {
        _openStopAction();
        assertTrue(reactive.stopDisarmed());
        uint256 callbacks = system.callbackCount();

        _buy(60_000 ether);
        _relay();

        assertFalse(reactive.stopDisarmed());
        assertEq(system.callbackCount(), callbacks + 1);
        assertEq(
            _selectorOf(_lastCallback().payload),
            IHeadsUpGuard.cancelOnRecovery.selector
        );
    }

    function test_gapStillFiresWhileStopIsDisarmed() public {
        uint256 id = _openStopAction();
        _vetoAndWaitOutCooldown(id);
        assertTrue(reactive.stopDisarmed());
        uint256 callbacks = system.callbackCount();

        _sell(40 ether);
        _relay();

        assertEq(system.callbackCount(), callbacks + 1);
        (, IHeadsUpGuard.Trigger trigger, ) = abi.decode(
            _args(_lastCallback().payload),
            (address, IHeadsUpGuard.Trigger, uint256)
        );
        assertEq(uint8(trigger), uint8(IHeadsUpGuard.Trigger.PriceGap));
    }

    function test_gapBelowStopLevelDisarmsStop() public {
        assertFalse(reactive.stopDisarmed());
        _openPending();
        assertTrue(reactive.stopDisarmed());
    }

    function test_gapAboveStopLevelKeepsStopArmed() public {
        HeadsUpReactive.Config memory config = _defaultConfig();
        config.stopPrice = 1_500 ether;
        HeadsUpReactive fresh = new HeadsUpReactive(config);
        uint256 syncTopic = uint256(keccak256("Sync(uint112,uint112)"));

        vm.startPrank(SYSTEM_ADDRESS);
        fresh.react(
            _record(
                address(pool),
                syncTopic,
                0,
                abi.encode(uint112(1_000 ether), uint112(2_000_000 ether)),
                block.chainid
            )
        );
        uint256 callbacks = system.callbackCount();
        fresh.react(
            _record(
                address(pool),
                syncTopic,
                0,
                abi.encode(uint112(1_040 ether), uint112(1_846_000 ether)),
                block.chainid
            )
        );
        assertEq(system.callbackCount(), callbacks + 1);

        bytes memory opened = abi.encode(
            uint8(1),
            uint16(5_000),
            uint256(1_775 ether),
            uint64(block.timestamp + 60)
        );
        fresh.react(
            _record(
                address(guard),
                uint256(IHeadsUpGuard.ActionOpened.selector),
                1,
                opened,
                block.chainid,
                2
            )
        );
        vm.stopPrank();

        assertTrue(fresh.pendingActive());
        assertFalse(fresh.stopDisarmed());
    }

    function test_failedOpenDoesNotDisarmStop() public {
        _sell(20 ether);
        _relay();
        assertEq(system.callbackCount(), 1);
        assertFalse(reactive.stopDisarmed());

        vm.warp(block.timestamp + REQUEST_TIMEOUT);
        _sell(1 ether);
        _relay();
        assertEq(system.callbackCount(), 2);
    }

    function test_constructorRejectsRearmAboveBps() public {
        HeadsUpReactive.Config memory config = _defaultConfig();
        config.rearmBps = 10_001;
        vm.expectRevert(HeadsUpReactive.InvalidConfig.selector);
        new HeadsUpReactive(config);
    }

    function test_ownerCanWithdrawNative() public {
        assertEq(reactive.OWNER(), address(this));
        vm.deal(address(reactive), 1 ether);
        reactive.withdrawNative(payable(owner), 0.4 ether);
        assertEq(owner.balance, 0.4 ether);
        assertEq(address(reactive).balance, 0.6 ether);
    }

    function test_withdrawNativeRejectsStrangers() public {
        vm.deal(address(reactive), 1 ether);
        vm.prank(stranger);
        vm.expectRevert(HeadsUpReactive.NotOwner.selector);
        reactive.withdrawNative(payable(stranger), 1 ether);
    }
}
