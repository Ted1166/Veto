// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IPayable} from "reactive-lib/interfaces/IPayable.sol";
import {AbstractCallback} from "reactive-lib/base/AbstractCallback.sol";
import {IHeadsUpGuard} from "./interfaces/IHeadsUpGuard.sol";
import {IPositionVault} from "./interfaces/IPositionVault.sol";

contract HeadsUpGuard is AbstractCallback, IHeadsUpGuard {
    uint16 private constant BPS = 10_000;

    IPositionVault public immutable vault;
    address public immutable owner;
    uint16 public immutable reduceBps;
    uint64 public immutable decisionWindow;
    uint64 public immutable escalatedWindow;

    uint256 public actionCount;
    uint256 public activeActionId;

    mapping(uint256 id => Action) private _actions;

    event NativeWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier onlyReactive(address rvm) {
        _checkReactive(rvm);
        _;
    }

    constructor(
        IPayable callbackProxy,
        address reactiveContract,
        IPositionVault vault_,
        uint16 reduceBps_,
        uint64 decisionWindow_,
        uint64 escalatedWindow_
    ) payable AbstractCallback(callbackProxy, reactiveContract) {
        if (
            address(vault_) == address(0) ||
            reactiveContract == address(0) ||
            reduceBps_ == 0 ||
            reduceBps_ > BPS ||
            decisionWindow_ == 0 ||
            escalatedWindow_ == 0 ||
            escalatedWindow_ > decisionWindow_
        ) revert InvalidConfig();
        vault = vault_;
        owner = vault_.owner();
        reduceBps = reduceBps_;
        decisionWindow = decisionWindow_;
        escalatedWindow = escalatedWindow_;
    }

    function openAction(
        address rvm,
        Trigger trigger,
        uint256 price
    ) external onlyReactive(rvm) {
        if (activeActionId != 0) {
            emit OpenIgnored(activeActionId, price);
            return;
        }

        uint256 id = ++actionCount;
        uint64 openedAt = uint64(block.timestamp);
        uint64 deadline = openedAt + decisionWindow;

        Action storage action = _actions[id];
        action.trigger = trigger;
        action.status = Status.Pending;
        action.proposedBps = reduceBps;
        action.openedAt = openedAt;
        action.deadline = deadline;
        action.triggerPrice = price;
        action.latestPrice = price;
        activeActionId = id;

        emit ActionOpened(id, trigger, reduceBps, price, deadline);
    }

    function escalate(
        address rvm,
        uint256 id,
        uint256 price
    ) external onlyReactive(rvm) {
        Action storage action = _actions[id];
        if (action.status != Status.Pending || action.escalated) return;

        action.escalated = true;
        action.proposedBps = BPS;
        action.latestPrice = price;

        uint64 shortened = uint64(block.timestamp) + escalatedWindow;
        if (shortened < action.deadline) action.deadline = shortened;

        emit ActionEscalated(id, action.proposedBps, price, action.deadline);
    }

    function cancelOnRecovery(
        address rvm,
        uint256 id,
        uint256 price
    ) external onlyReactive(rvm) {
        Action storage action = _actions[id];
        if (action.status != Status.Pending) return;
        action.latestPrice = price;
        _close(id, action, Status.Cancelled);
    }

    function defaultFromReactive(
        address rvm,
        uint256 id
    ) external onlyReactive(rvm) {
        Action storage action = _actions[id];
        if (
            action.status != Status.Pending || block.timestamp < action.deadline
        ) return;
        _execute(id, action, Status.Defaulted, action.proposedBps);
    }

    function approve(uint256 id) external onlyOwner {
        Action storage action = _decidable(id);
        _execute(id, action, Status.Approved, action.proposedBps);
    }

    function resize(uint256 id, uint16 bps) external onlyOwner {
        if (bps == 0 || bps > BPS) revert InvalidBps(bps);
        Action storage action = _decidable(id);
        _execute(id, action, Status.Resized, bps);
    }

    function veto(uint256 id) external onlyOwner {
        Action storage action = _decidable(id);
        _close(id, action, Status.Vetoed);
    }

    function executeDefault(uint256 id) external {
        Action storage action = _actions[id];
        if (action.status != Status.Pending) revert NotPending(id);
        if (block.timestamp < action.deadline)
            revert DeadlineNotReached(id, action.deadline);
        _execute(id, action, Status.Defaulted, action.proposedBps);
    }

    function coverDebt() external {
        _coverDebt();
    }

    function withdrawNative(
        address payable to,
        uint256 amount
    ) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit NativeWithdrawn(to, amount);
    }

    function getAction(uint256 id) external view returns (Action memory) {
        return _actions[id];
    }

    function timeLeft(uint256 id) external view returns (uint256) {
        Action storage action = _actions[id];
        if (
            action.status != Status.Pending ||
            block.timestamp >= action.deadline
        ) return 0;
        return action.deadline - block.timestamp;
    }

    function _checkOwner() private view {
        if (msg.sender != owner) revert NotOwner();
    }

    function _checkReactive(address rvm) private view {
        _onlyServiceProvider();
        _onlyCallbackSender(rvm);
    }

    function _decidable(
        uint256 id
    ) private view returns (Action storage action) {
        action = _actions[id];
        if (action.status != Status.Pending) revert NotPending(id);
        if (block.timestamp >= action.deadline)
            revert DecisionWindowClosed(id, action.deadline);
    }

    function _execute(
        uint256 id,
        Action storage action,
        Status status,
        uint16 bps
    ) private {
        action.status = status;
        action.executedBps = bps;
        action.resolvedAt = uint64(block.timestamp);
        activeActionId = 0;

        uint256 received = vault.reduce(bps);
        action.stableReceived = received;

        emit ActionResolved(id, status, bps, received);
    }

    function _close(uint256 id, Action storage action, Status status) private {
        action.status = status;
        action.resolvedAt = uint64(block.timestamp);
        activeActionId = 0;
        emit ActionResolved(id, status, 0, 0);
    }
}
