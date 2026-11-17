// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";

contract MockSystemContract is ISystemContract {
    struct Subscription {
        address subscriber;
        uint256 chainId;
        address target;
        uint256 topic0;
    }

    Subscription[] private _subscriptions;
    Subscription[] private _unsubscriptions;
    CallbackConfiguration_V_1_0[] private _callbacks;
    mapping(address => uint256) private _debts;

    receive() external payable {}

    function setDebt(address account, uint256 amount) external {
        _debts[account] = amount;
    }

    function debt(address account) external view returns (uint256) {
        return _debts[account];
    }

    function subscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256,
        uint256,
        uint256
    ) external {
        _subscriptions.push(
            Subscription({
                subscriber: msg.sender,
                chainId: chainId_,
                target: contract_,
                topic0: topic0_
            })
        );
    }

    function unsubscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256,
        uint256,
        uint256
    ) external {
        _unsubscriptions.push(
            Subscription({
                subscriber: msg.sender,
                chainId: chainId_,
                target: contract_,
                topic0: topic0_
            })
        );
    }

    function requestCallback(CallbackVersion, bytes memory config_) external {
        _callbacks.push(abi.decode(config_, (CallbackConfiguration_V_1_0)));
    }

    function requestCallbackV_1_0(
        CallbackConfiguration_V_1_0 memory config_
    ) external {
        _callbacks.push(config_);
    }

    function subscriptionCount() external view returns (uint256) {
        return _subscriptions.length;
    }

    function unsubscriptionCount() external view returns (uint256) {
        return _unsubscriptions.length;
    }

    function unsubscriptionAt(
        uint256 index
    ) external view returns (Subscription memory) {
        return _unsubscriptions[index];
    }

    function subscriptionAt(
        uint256 index
    ) external view returns (Subscription memory) {
        return _subscriptions[index];
    }

    function callbackCount() external view returns (uint256) {
        return _callbacks.length;
    }

    function callbackAt(
        uint256 index
    ) external view returns (CallbackConfiguration_V_1_0 memory) {
        return _callbacks[index];
    }
}
