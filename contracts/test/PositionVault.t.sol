// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Harness} from "./utils/Harness.sol";
import {PositionVault} from "../src/fixtures/PositionVault.sol";

contract PositionVaultTest is Harness {
    address internal guardAccount = makeAddr("guardAccount");

    function setUp() public {
        _deployStack();
        vm.prank(owner);
        vault.setGuard(guardAccount);
    }

    function test_setGuardOnlyOwner() public {
        PositionVault fresh = new PositionVault(owner, pool, risk, stable);
        vm.prank(stranger);
        vm.expectRevert(PositionVault.NotOwner.selector);
        fresh.setGuard(guardAccount);
    }

    function test_setGuardOnlyOnce() public {
        vm.prank(owner);
        vm.expectRevert(PositionVault.GuardAlreadySet.selector);
        vault.setGuard(stranger);
    }

    function test_setGuardRejectsZeroAddress() public {
        PositionVault fresh = new PositionVault(owner, pool, risk, stable);
        vm.prank(owner);
        vm.expectRevert(PositionVault.ZeroAddress.selector);
        fresh.setGuard(address(0));
    }

    function test_constructorRejectsZeroOwner() public {
        vm.expectRevert(PositionVault.ZeroAddress.selector);
        new PositionVault(address(0), pool, risk, stable);
    }

    function test_reduceOnlyGuard() public {
        vm.prank(stranger);
        vm.expectRevert(PositionVault.NotGuard.selector);
        vault.reduce(5_000);
    }

    function test_reduceSellsRequestedShare() public {
        uint256 expectedOut = pool.quote(address(risk), VAULT_RISK / 2);

        vm.expectEmit(address(vault));
        emit PositionVault.Reduced(5_000, VAULT_RISK / 2, expectedOut);
        vm.prank(guardAccount);
        uint256 received = vault.reduce(5_000);

        assertEq(received, expectedOut);
        assertEq(vault.riskBalance(), VAULT_RISK / 2);
        assertEq(vault.stableBalance(), expectedOut);
    }

    function test_reduceFullExitSellsEverything() public {
        vm.prank(guardAccount);
        vault.reduce(10_000);
        assertEq(vault.riskBalance(), 0);
        assertGt(vault.stableBalance(), 0);
    }

    function test_reduceRejectsInvalidBps() public {
        vm.startPrank(guardAccount);
        vm.expectRevert(
            abi.encodeWithSelector(PositionVault.InvalidBps.selector, uint16(0))
        );
        vault.reduce(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                PositionVault.InvalidBps.selector,
                uint16(10_001)
            )
        );
        vault.reduce(10_001);
        vm.stopPrank();
    }

    function test_reduceWithEmptyVaultIsNoop() public {
        vm.startPrank(owner);
        vault.withdraw(risk, VAULT_RISK, owner);
        vm.stopPrank();
        vm.prank(guardAccount);
        assertEq(vault.reduce(5_000), 0);
    }

    function test_withdrawOnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.withdraw(risk, 1 ether, stranger);
    }

    function test_withdrawMovesTokens() public {
        vm.prank(owner);
        vault.withdraw(risk, 4 ether, owner);
        assertEq(risk.balanceOf(owner), 4 ether);
        assertEq(vault.riskBalance(), VAULT_RISK - 4 ether);
    }

    function testFuzz_reduceLeavesRemainder(uint16 bps) public {
        bps = uint16(bound(bps, 1, 10_000));
        vm.prank(guardAccount);
        vault.reduce(bps);
        assertEq(vault.riskBalance(), VAULT_RISK - (VAULT_RISK * bps) / 10_000);
    }
}
