// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {AbstractPayer} from "reactive-lib/base/AbstractPayer.sol";
import {AbstractCallback} from "reactive-lib/base/AbstractCallback.sol";
import {Harness} from "./utils/Harness.sol";
import {HeadsUpGuard} from "../src/HeadsUpGuard.sol";
import {IHeadsUpGuard} from "../src/interfaces/IHeadsUpGuard.sol";
import {MockSystemContract} from "./mocks/MockSystemContract.sol";

contract HeadsUpGuardTest is Harness {
    address internal rvm = makeAddr("rvm");

    function setUp() public {
        _deployStack();
        _deployGuard(rvm);
    }

    function _open(IHeadsUpGuard.Trigger trigger, uint256 price) internal {
        vm.prank(CALLBACK_PROXY);
        guard.openAction(rvm, trigger, price);
    }

    function _openDefault() internal returns (uint256 id) {
        _open(IHeadsUpGuard.Trigger.PriceGap, 1_850 ether);
        id = guard.activeActionId();
    }

    function test_constructorRejectsInvalidConfig() public {
        MockSystemContract proxy = MockSystemContract(payable(CALLBACK_PROXY));
        vm.expectRevert(IHeadsUpGuard.InvalidConfig.selector);
        new HeadsUpGuard(
            proxy,
            rvm,
            vault,
            0,
            DECISION_WINDOW,
            ESCALATED_WINDOW
        );
        vm.expectRevert(IHeadsUpGuard.InvalidConfig.selector);
        new HeadsUpGuard(
            proxy,
            rvm,
            vault,
            10_001,
            DECISION_WINDOW,
            ESCALATED_WINDOW
        );
        vm.expectRevert(IHeadsUpGuard.InvalidConfig.selector);
        new HeadsUpGuard(proxy, rvm, vault, REDUCE_BPS, 0, ESCALATED_WINDOW);
        vm.expectRevert(IHeadsUpGuard.InvalidConfig.selector);
        new HeadsUpGuard(proxy, rvm, vault, REDUCE_BPS, DECISION_WINDOW, 0);
        vm.expectRevert(IHeadsUpGuard.InvalidConfig.selector);
        new HeadsUpGuard(proxy, rvm, vault, REDUCE_BPS, 10, 11);
        vm.expectRevert(IHeadsUpGuard.InvalidConfig.selector);
        new HeadsUpGuard(
            proxy,
            address(0),
            vault,
            REDUCE_BPS,
            DECISION_WINDOW,
            ESCALATED_WINDOW
        );
    }

    function test_ownerComesFromVault() public view {
        assertEq(guard.owner(), owner);
    }

    function test_openActionCreatesPendingAction() public {
        vm.expectEmit(true, false, false, true, address(guard));
        emit IHeadsUpGuard.ActionOpened(
            1,
            IHeadsUpGuard.Trigger.PriceGap,
            REDUCE_BPS,
            1_850 ether,
            uint64(block.timestamp) + DECISION_WINDOW
        );
        uint256 id = _openDefault();

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertEq(id, 1);
        assertEq(uint8(action.status), uint8(IHeadsUpGuard.Status.Pending));
        assertEq(uint8(action.trigger), uint8(IHeadsUpGuard.Trigger.PriceGap));
        assertEq(action.proposedBps, REDUCE_BPS);
        assertEq(action.deadline, uint64(block.timestamp) + DECISION_WINDOW);
        assertEq(action.triggerPrice, 1_850 ether);
        assertEq(guard.timeLeft(id), DECISION_WINDOW);
    }

    function test_openActionRejectsCallerOtherThanProxy() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                AbstractPayer.NotAuthorized.selector,
                stranger,
                CALLBACK_PROXY
            )
        );
        guard.openAction(rvm, IHeadsUpGuard.Trigger.PriceGap, 1 ether);
    }

    function test_openActionRejectsUnknownReactiveContract() public {
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(
            abi.encodeWithSelector(
                AbstractCallback.CallbackNotAuthorized.selector,
                stranger,
                rvm
            )
        );
        guard.openAction(stranger, IHeadsUpGuard.Trigger.PriceGap, 1 ether);
    }

    function test_duplicateOpenIsIgnored() public {
        uint256 id = _openDefault();
        vm.expectEmit(address(guard));
        emit IHeadsUpGuard.OpenIgnored(id, 1_700 ether);
        _open(IHeadsUpGuard.Trigger.StopLossProximity, 1_700 ether);
        assertEq(guard.actionCount(), 1);
        assertEq(guard.activeActionId(), id);
    }

    function test_approveExecutesProposedReduction() public {
        uint256 id = _openDefault();
        vm.prank(owner);
        guard.approve(id);

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertEq(uint8(action.status), uint8(IHeadsUpGuard.Status.Approved));
        assertEq(action.executedBps, REDUCE_BPS);
        assertGt(action.stableReceived, 0);
        assertEq(action.stableReceived, vault.stableBalance());
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
        assertEq(guard.activeActionId(), 0);
    }

    function test_resizeExecutesCustomReduction() public {
        uint256 id = _openDefault();
        vm.prank(owner);
        guard.resize(id, 2_500);

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertEq(uint8(action.status), uint8(IHeadsUpGuard.Status.Resized));
        assertEq(action.executedBps, 2_500);
        assertEq(vault.riskBalance(), (VAULT_RISK * 7_500) / 10_000);
    }

    function test_resizeRejectsInvalidBps() public {
        uint256 id = _openDefault();
        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IHeadsUpGuard.InvalidBps.selector, uint16(0))
        );
        guard.resize(id, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IHeadsUpGuard.InvalidBps.selector,
                uint16(10_001)
            )
        );
        guard.resize(id, 10_001);
        vm.stopPrank();
    }

    function test_vetoLeavesPositionUntouched() public {
        uint256 id = _openDefault();
        vm.prank(owner);
        guard.veto(id);

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertEq(uint8(action.status), uint8(IHeadsUpGuard.Status.Vetoed));
        assertEq(action.executedBps, 0);
        assertEq(vault.riskBalance(), VAULT_RISK);
        assertEq(guard.activeActionId(), 0);
    }

    function test_decisionsAreOwnerOnly() public {
        uint256 id = _openDefault();
        vm.startPrank(stranger);
        vm.expectRevert(IHeadsUpGuard.NotOwner.selector);
        guard.approve(id);
        vm.expectRevert(IHeadsUpGuard.NotOwner.selector);
        guard.resize(id, 1_000);
        vm.expectRevert(IHeadsUpGuard.NotOwner.selector);
        guard.veto(id);
        vm.stopPrank();
    }

    function test_decisionsClosedAfterDeadline() public {
        uint256 id = _openDefault();
        uint64 deadline = guard.getAction(id).deadline;
        vm.warp(deadline);
        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                IHeadsUpGuard.DecisionWindowClosed.selector,
                id,
                deadline
            )
        );
        guard.approve(id);
        vm.expectRevert(
            abi.encodeWithSelector(
                IHeadsUpGuard.DecisionWindowClosed.selector,
                id,
                deadline
            )
        );
        guard.veto(id);
        vm.stopPrank();
        assertEq(guard.timeLeft(id), 0);
    }

    function test_decisionOnUnknownActionReverts() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IHeadsUpGuard.NotPending.selector, 99)
        );
        guard.approve(99);
    }

    function test_decisionCannotRepeat() public {
        uint256 id = _openDefault();
        vm.startPrank(owner);
        guard.veto(id);
        vm.expectRevert(
            abi.encodeWithSelector(IHeadsUpGuard.NotPending.selector, id)
        );
        guard.approve(id);
        vm.stopPrank();
    }

    function test_executeDefaultRevertsBeforeDeadline() public {
        uint256 id = _openDefault();
        uint64 deadline = guard.getAction(id).deadline;
        vm.expectRevert(
            abi.encodeWithSelector(
                IHeadsUpGuard.DeadlineNotReached.selector,
                id,
                deadline
            )
        );
        guard.executeDefault(id);
    }

    function test_executeDefaultIsPermissionlessAfterDeadline() public {
        uint256 id = _openDefault();
        vm.warp(guard.getAction(id).deadline);
        vm.prank(stranger);
        guard.executeDefault(id);

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertEq(uint8(action.status), uint8(IHeadsUpGuard.Status.Defaulted));
        assertEq(action.executedBps, REDUCE_BPS);
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
        assertEq(guard.activeActionId(), 0);
    }

    function test_executeDefaultCannotRepeat() public {
        uint256 id = _openDefault();
        vm.warp(guard.getAction(id).deadline);
        guard.executeDefault(id);
        vm.expectRevert(
            abi.encodeWithSelector(IHeadsUpGuard.NotPending.selector, id)
        );
        guard.executeDefault(id);
    }

    function test_cancelOnRecoveryClosesPendingAction() public {
        uint256 id = _openDefault();
        vm.prank(CALLBACK_PROXY);
        guard.cancelOnRecovery(rvm, id, 1_990 ether);

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertEq(uint8(action.status), uint8(IHeadsUpGuard.Status.Cancelled));
        assertEq(action.latestPrice, 1_990 ether);
        assertEq(vault.riskBalance(), VAULT_RISK);
        assertEq(guard.activeActionId(), 0);
    }

    function test_cancelAfterResolutionIsNoop() public {
        uint256 id = _openDefault();
        vm.prank(owner);
        guard.approve(id);
        vm.prank(CALLBACK_PROXY);
        guard.cancelOnRecovery(rvm, id, 1_990 ether);
        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Approved)
        );
    }

    function test_escalateUpgradesToExitAndShortensDeadline() public {
        uint256 id = _openDefault();
        uint64 openedAt = uint64(block.timestamp);
        vm.warp(block.timestamp + 10);

        vm.prank(CALLBACK_PROXY);
        guard.escalate(rvm, id, 1_700 ether);

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertTrue(action.escalated);
        assertEq(action.proposedBps, 10_000);
        assertEq(action.deadline, openedAt + 10 + ESCALATED_WINDOW);
        assertEq(action.latestPrice, 1_700 ether);

        vm.warp(action.deadline);
        guard.executeDefault(id);
        assertEq(vault.riskBalance(), 0);
    }

    function test_escalateNeverExtendsDeadline() public {
        uint256 id = _openDefault();
        uint64 originalDeadline = guard.getAction(id).deadline;
        vm.warp(block.timestamp + 55);
        vm.prank(CALLBACK_PROXY);
        guard.escalate(rvm, id, 1_700 ether);
        assertEq(guard.getAction(id).deadline, originalDeadline);
    }

    function test_escalateOnlyOnce() public {
        uint256 id = _openDefault();
        vm.startPrank(CALLBACK_PROXY);
        guard.escalate(rvm, id, 1_700 ether);
        uint64 deadline = guard.getAction(id).deadline;
        vm.warp(block.timestamp + 5);
        guard.escalate(rvm, id, 1_600 ether);
        vm.stopPrank();
        assertEq(guard.getAction(id).deadline, deadline);
        assertEq(guard.getAction(id).latestPrice, 1_700 ether);
    }

    function test_ownerCanStillResizeAfterEscalation() public {
        uint256 id = _openDefault();
        vm.prank(CALLBACK_PROXY);
        guard.escalate(rvm, id, 1_700 ether);
        vm.prank(owner);
        guard.resize(id, 3_000);
        assertEq(vault.riskBalance(), (VAULT_RISK * 7_000) / 10_000);
    }

    function test_defaultFromReactiveWaitsForDeadline() public {
        uint256 id = _openDefault();
        vm.prank(CALLBACK_PROXY);
        guard.defaultFromReactive(rvm, id);
        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Pending)
        );

        vm.warp(guard.getAction(id).deadline);
        vm.prank(CALLBACK_PROXY);
        guard.defaultFromReactive(rvm, id);
        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Defaulted)
        );
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
    }

    function test_reactiveEntrypointsRejectStrangers() public {
        uint256 id = _openDefault();
        vm.startPrank(CALLBACK_PROXY);
        vm.expectRevert(
            abi.encodeWithSelector(
                AbstractCallback.CallbackNotAuthorized.selector,
                stranger,
                rvm
            )
        );
        guard.escalate(stranger, id, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AbstractCallback.CallbackNotAuthorized.selector,
                stranger,
                rvm
            )
        );
        guard.cancelOnRecovery(stranger, id, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AbstractCallback.CallbackNotAuthorized.selector,
                stranger,
                rvm
            )
        );
        guard.defaultFromReactive(stranger, id);
        vm.stopPrank();
    }

    function test_actionIdsIncrementAcrossActions() public {
        uint256 first = _openDefault();
        vm.prank(owner);
        guard.veto(first);
        uint256 second = _openDefault();
        assertEq(second, first + 1);
        assertEq(guard.actionCount(), 2);
    }

    function test_coverDebtPaysTheProxy() public {
        MockSystemContract proxy = MockSystemContract(payable(CALLBACK_PROXY));
        proxy.setDebt(address(guard), 1 ether);
        vm.deal(address(guard), 3 ether);
        guard.coverDebt();
        assertEq(CALLBACK_PROXY.balance, 1 ether);
        assertEq(address(guard).balance, 2 ether);
    }

    function test_withdrawNativeIsOwnerOnly() public {
        vm.deal(address(guard), 1 ether);
        vm.prank(stranger);
        vm.expectRevert(IHeadsUpGuard.NotOwner.selector);
        guard.withdrawNative(payable(stranger), 1 ether);

        vm.prank(owner);
        guard.withdrawNative(payable(owner), 1 ether);
        assertEq(owner.balance, 1 ether);
    }

    function testFuzz_resizeMatchesRequestedShare(uint16 bps) public {
        bps = uint16(bound(bps, 1, 10_000));
        uint256 id = _openDefault();
        vm.prank(owner);
        guard.resize(id, bps);
        assertEq(vault.riskBalance(), VAULT_RISK - (VAULT_RISK * bps) / 10_000);
    }
}
