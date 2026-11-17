// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Harness} from "./utils/Harness.sol";
import {MiniPool} from "../src/fixtures/MiniPool.sol";

contract MiniPoolTest is Harness {
    function setUp() public {
        _deployStack();
    }

    function test_seedSetsReservesAndPrice() public view {
        (uint112 reserve0, uint112 reserve1) = pool.getReserves();
        assertEq(reserve0, POOL_RISK);
        assertEq(reserve1, POOL_STABLE);
        assertEq(pool.spotPrice(), 2_000 ether);
    }

    function test_seedOnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(MiniPool.NotOwner.selector);
        pool.seed(1 ether, 1 ether);
    }

    function test_seedRejectsZeroAmounts() public {
        vm.expectRevert(MiniPool.ZeroAmount.selector);
        pool.seed(0, 1 ether);
    }

    function test_constructorRejectsIdenticalTokens() public {
        vm.expectRevert(MiniPool.IdenticalTokens.selector);
        new MiniPool(risk, risk);
    }

    function test_swapPaysQuotedAmountAndEmitsEvents() public {
        uint256 amountIn = 10 ether;
        uint256 expected = pool.quote(address(risk), amountIn);

        vm.expectEmit(address(pool));
        emit MiniPool.Sync(
            uint112(POOL_RISK + amountIn),
            uint112(POOL_STABLE - expected)
        );
        vm.expectEmit(true, true, false, true, address(pool));
        emit MiniPool.Swap(trader, amountIn, 0, 0, expected, trader);

        uint256 balanceBefore = stable.balanceOf(trader);
        uint256 out = _sell(amountIn);

        assertEq(out, expected);
        assertEq(stable.balanceOf(trader) - balanceBefore, expected);
    }

    function test_sellingRiskLowersPriceAndBuyingRaisesIt() public {
        uint256 start = pool.spotPrice();
        _sell(20 ether);
        uint256 afterSell = pool.spotPrice();
        assertLt(afterSell, start);
        _buy(100_000 ether);
        assertGt(pool.spotPrice(), afterSell);
    }

    function test_swapRevertsOnSlippage() public {
        uint256 expected = pool.quote(address(risk), 10 ether);
        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(
                MiniPool.SlippageExceeded.selector,
                expected,
                expected + 1
            )
        );
        pool.swap(address(risk), 10 ether, expected + 1, trader);
    }

    function test_swapRevertsOnZeroAmount() public {
        vm.prank(trader);
        vm.expectRevert(MiniPool.ZeroAmount.selector);
        pool.swap(address(risk), 0, 0, trader);
    }

    function test_swapRevertsOnUnknownToken() public {
        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(MiniPool.InvalidToken.selector, stranger)
        );
        pool.swap(stranger, 1 ether, 0, trader);
    }

    function test_getAmountOutRevertsWithoutLiquidity() public {
        vm.expectRevert(MiniPool.InsufficientLiquidity.selector);
        pool.getAmountOut(1 ether, 0, 1 ether);
    }

    function testFuzz_swapNeverDecreasesInvariant(
        uint256 amountIn,
        bool sellRisk
    ) public {
        amountIn = bound(amountIn, 1, 100_000 ether);
        (uint112 beforeReserve0, uint112 beforeReserve1) = pool.getReserves();
        uint256 invariantBefore = uint256(beforeReserve0) * beforeReserve1;

        if (sellRisk) _sell(amountIn);
        else _buy(amountIn);

        (uint112 afterReserve0, uint112 afterReserve1) = pool.getReserves();
        assertGe(uint256(afterReserve0) * afterReserve1, invariantBefore);
    }
}
