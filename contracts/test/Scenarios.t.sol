// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Harness} from "./utils/Harness.sol";
import {IHeadsUpGuard} from "../src/interfaces/IHeadsUpGuard.sol";

contract ScenariosTest is Harness {
    function setUp() public {
        _deployFullStack();
        _prime();
    }

    function test_approveScenario() public {
        uint256 id = _openPending();
        uint256 priceBefore = pool.spotPrice();

        vm.prank(owner);
        guard.approve(id);
        _relay();

        IHeadsUpGuard.Action memory action = guard.getAction(id);
        assertEq(uint8(action.status), uint8(IHeadsUpGuard.Status.Approved));
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
        assertGt(vault.stableBalance(), 0);
        assertLt(pool.spotPrice(), priceBefore);
        assertFalse(reactive.pendingActive());
        assertEq(reactive.cooldownUntil(), uint64(block.timestamp) + COOLDOWN);
    }

    function test_resizeScenario() public {
        uint256 id = _openPending();
        vm.prank(owner);
        guard.resize(id, 8_000);
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Resized)
        );
        assertEq(vault.riskBalance(), (VAULT_RISK * 2_000) / 10_000);
        assertFalse(reactive.pendingActive());
    }

    function test_vetoScenario() public {
        uint256 id = _openPending();
        vm.prank(owner);
        guard.veto(id);
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Vetoed)
        );
        assertEq(vault.riskBalance(), VAULT_RISK);
        assertEq(vault.stableBalance(), 0);
        assertFalse(reactive.pendingActive());
    }

    function test_timeoutScenarioWithPermissionlessKeeper() public {
        uint256 id = _openPending();
        vm.warp(guard.getAction(id).deadline);

        vm.prank(stranger);
        guard.executeDefault(id);
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Defaulted)
        );
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
        assertFalse(reactive.pendingActive());
    }

    function test_recoveryScenario() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();

        _buy(50_000 ether);
        _relay();
        assertTrue(_deliver(callbacks));
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Cancelled)
        );
        assertEq(vault.riskBalance(), VAULT_RISK);
        assertFalse(reactive.pendingActive());
    }

    function test_escalationToExitScenario() public {
        uint256 id = _openPending();
        uint256 callbacks = system.callbackCount();

        _sell(40 ether);
        _relay();
        assertTrue(_deliver(callbacks));
        _relay();

        vm.warp(guard.getAction(id).deadline);
        _buy(1 ether);
        _relay();
        assertTrue(_deliver(callbacks + 1));
        _relay();

        assertEq(
            uint8(guard.getAction(id).status),
            uint8(IHeadsUpGuard.Status.Defaulted)
        );
        assertEq(guard.getAction(id).executedBps, 10_000);
        assertEq(vault.riskBalance(), 0);
    }

    function test_secondActionOpensAfterCooldown() public {
        uint256 first = _openPending();
        vm.prank(owner);
        guard.veto(first);
        _relay();

        vm.warp(block.timestamp + COOLDOWN);
        uint256 second = _openPending();
        assertEq(second, first + 1);
    }
}
