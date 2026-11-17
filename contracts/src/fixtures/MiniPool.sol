// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MiniPool {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS = 10_000;
    uint256 private constant PRICE_SCALE = 1e18;

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    address public immutable owner;

    uint112 private _reserve0;
    uint112 private _reserve1;

    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    error NotOwner();
    error ZeroAmount();
    error IdenticalTokens();
    error InvalidToken(address token);
    error InsufficientLiquidity();
    error ReserveOverflow();
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);

    constructor(IERC20 token0_, IERC20 token1_) {
        if (address(token0_) == address(token1_)) revert IdenticalTokens();
        token0 = token0_;
        token1 = token1_;
        owner = msg.sender;
    }

    function getReserves() external view returns (uint112, uint112) {
        return (_reserve0, _reserve1);
    }

    function spotPrice() external view returns (uint256) {
        if (_reserve0 == 0) return 0;
        return (uint256(_reserve1) * PRICE_SCALE) / _reserve0;
    }

    function seed(uint256 amount0, uint256 amount1) external {
        if (msg.sender != owner) revert NotOwner();
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        _sync();
    }

    function quote(
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256) {
        (bool zeroForOne, ) = _direction(tokenIn);
        (uint256 reserveIn, uint256 reserveOut) = zeroForOne
            ? (_reserve0, _reserve1)
            : (_reserve1, _reserve0);
        return getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        (bool zeroForOne, IERC20 tokenOut) = _direction(tokenIn);
        (uint256 reserveIn, uint256 reserveOut) = zeroForOne
            ? (_reserve0, _reserve1)
            : (_reserve1, _reserve0);

        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        if (amountOut < minAmountOut)
            revert SlippageExceeded(amountOut, minAmountOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        tokenOut.safeTransfer(to, amountOut);
        _sync();

        emit Swap(
            msg.sender,
            zeroForOne ? amountIn : 0,
            zeroForOne ? 0 : amountIn,
            zeroForOne ? 0 : amountOut,
            zeroForOne ? amountOut : 0,
            to
        );
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        return
            (amountInWithFee * reserveOut) /
            (reserveIn * BPS + amountInWithFee);
    }

    function _direction(
        address tokenIn
    ) private view returns (bool zeroForOne, IERC20 tokenOut) {
        if (tokenIn == address(token0)) return (true, token1);
        if (tokenIn == address(token1)) return (false, token0);
        revert InvalidToken(tokenIn);
    }

    function _sync() private {
        uint256 balance0 = token0.balanceOf(address(this));
        uint256 balance1 = token1.balanceOf(address(this));
        if (balance0 > type(uint112).max || balance1 > type(uint112).max)
            revert ReserveOverflow();
        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
        emit Sync(_reserve0, _reserve1);
    }
}
