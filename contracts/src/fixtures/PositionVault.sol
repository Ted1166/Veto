// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPositionVault} from "../interfaces/IPositionVault.sol";
import {MiniPool} from "./MiniPool.sol";

contract PositionVault is IPositionVault {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    address public immutable override owner;
    IERC20 public immutable riskToken;
    IERC20 public immutable stableToken;
    MiniPool public immutable pool;
    address public guard;

    event GuardSet(address indexed guard);
    event Reduced(uint16 bps, uint256 riskSold, uint256 stableReceived);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotGuard();
    error GuardAlreadySet();
    error ZeroAddress();
    error InvalidBps(uint16 bps);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    constructor(
        address owner_,
        MiniPool pool_,
        IERC20 riskToken_,
        IERC20 stableToken_
    ) {
        if (owner_ == address(0) || address(pool_) == address(0))
            revert ZeroAddress();
        owner = owner_;
        pool = pool_;
        riskToken = riskToken_;
        stableToken = stableToken_;
    }

    function setGuard(address guard_) external onlyOwner {
        if (guard != address(0)) revert GuardAlreadySet();
        if (guard_ == address(0)) revert ZeroAddress();
        guard = guard_;
        emit GuardSet(guard_);
    }

    function reduce(uint16 bps) external returns (uint256 stableReceived) {
        if (msg.sender != guard) revert NotGuard();
        if (bps == 0 || bps > BPS) revert InvalidBps(bps);

        uint256 amountIn = (riskToken.balanceOf(address(this)) * bps) / BPS;
        if (amountIn > 0) {
            riskToken.forceApprove(address(pool), amountIn);
            stableReceived = pool.swap(
                address(riskToken),
                amountIn,
                0,
                address(this)
            );
        }
        emit Reduced(bps, amountIn, stableReceived);
    }

    function withdraw(
        IERC20 token,
        uint256 amount,
        address to
    ) external onlyOwner {
        token.safeTransfer(to, amount);
        emit Withdrawn(address(token), to, amount);
    }

    function _checkOwner() private view {
        if (msg.sender != owner) revert NotOwner();
    }

    function riskBalance() external view returns (uint256) {
        return riskToken.balanceOf(address(this));
    }

    function stableBalance() external view returns (uint256) {
        return stableToken.balanceOf(address(this));
    }
}
