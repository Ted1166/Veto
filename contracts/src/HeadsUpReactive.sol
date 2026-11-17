// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {AbstractReactive} from "reactive-lib/base/AbstractReactive.sol";
import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";
import {IHeadsUpGuard} from "./interfaces/IHeadsUpGuard.sol";
import {CronTopics} from "./libraries/CronTopics.sol";

contract HeadsUpReactive is AbstractReactive {
    enum Directive {
        Cancel,
        Escalate,
        ExecuteDefault
    }

    struct Config {
        uint256 chainId;
        address pool;
        address guard;
        bool riskIsToken0;
        uint256 stopPrice;
        uint16 stopProximityBps;
        uint16 gapBps;
        uint16 recoverBps;
        uint16 escalateBps;
        uint16 rearmBps;
        uint64 cooldown;
        uint64 requestTimeout;
        uint64 callbackGas;
        uint256 tickTopic;
    }

    uint256 private constant BPS = 10_000;
    uint256 private constant PRICE_SCALE = 1e18;
    uint64 private constant DEFAULT_RETRY = 15;
    uint64 private constant STALE_GRACE = 600;

    uint256 private constant SYNC_TOPIC =
        uint256(keccak256("Sync(uint112,uint112)"));
    uint256 private constant OPENED_TOPIC =
        uint256(keccak256("ActionOpened(uint256,uint8,uint16,uint256,uint64)"));
    uint256 private constant ESCALATED_TOPIC =
        uint256(keccak256("ActionEscalated(uint256,uint16,uint256,uint64)"));
    uint256 private constant RESOLVED_TOPIC =
        uint256(keccak256("ActionResolved(uint256,uint8,uint16,uint256)"));

    uint256 public immutable CHAIN_ID;
    address public immutable POOL;
    address public immutable GUARD;
    bool public immutable RISK_IS_TOKEN0;
    uint256 public immutable STOP_PRICE;
    uint16 public immutable STOP_PROXIMITY_BPS;
    uint16 public immutable GAP_BPS;
    uint16 public immutable RECOVER_BPS;
    uint16 public immutable ESCALATE_BPS;
    uint16 public immutable REARM_BPS;
    address public immutable OWNER;
    uint64 public immutable COOLDOWN;
    uint64 public immutable REQUEST_TIMEOUT;
    uint64 public immutable CALLBACK_GAS;
    uint256 public immutable TICK_TOPIC;

    uint256 public lastPrice;
    uint256 public pendingId;
    uint256 public anchorPrice;
    uint64 public pendingDeadline;
    uint64 public openRequestedAt;
    uint64 public cooldownUntil;
    uint64 public lastDefaultRequestAt;
    bool public pendingActive;
    bool public escalationSent;
    bool public cancelSent;
    bool public tickActive;
    bool public stopDisarmed;

    event TriggerFired(
        IHeadsUpGuard.Trigger indexed trigger,
        uint256 price,
        uint256 previousPrice
    );
    event DirectiveSent(
        Directive indexed directive,
        uint256 indexed actionId,
        uint256 price
    );
    event PendingTracked(
        uint256 indexed actionId,
        uint256 anchorPrice,
        uint64 deadline
    );
    event PendingCleared(uint256 indexed actionId, uint64 cooldownUntil);
    event StopDisarmed(uint256 price);
    event StopRearmed(uint256 price);
    event NativeWithdrawn(address indexed to, uint256 amount);

    error InvalidConfig();
    error NotOwner();

    constructor(Config memory config) payable {
        if (
            config.pool == address(0) ||
            config.guard == address(0) ||
            config.stopPrice == 0 ||
            config.stopProximityBps > BPS ||
            config.gapBps == 0 ||
            config.gapBps >= BPS ||
            config.recoverBps == 0 ||
            config.escalateBps == 0 ||
            config.escalateBps >= BPS ||
            config.rearmBps > BPS ||
            config.requestTimeout == 0 ||
            config.callbackGas == 0 ||
            !CronTopics.isValid(config.tickTopic)
        ) revert InvalidConfig();

        CHAIN_ID = config.chainId;
        POOL = config.pool;
        GUARD = config.guard;
        RISK_IS_TOKEN0 = config.riskIsToken0;
        STOP_PRICE = config.stopPrice;
        STOP_PROXIMITY_BPS = config.stopProximityBps;
        GAP_BPS = config.gapBps;
        RECOVER_BPS = config.recoverBps;
        ESCALATE_BPS = config.escalateBps;
        REARM_BPS = config.rearmBps;
        OWNER = msg.sender;
        COOLDOWN = config.cooldown;
        REQUEST_TIMEOUT = config.requestTimeout;
        CALLBACK_GAS = config.callbackGas;
        TICK_TOPIC = config.tickTopic;

        SYSTEM.subscribe(
            config.chainId,
            config.pool,
            SYNC_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        SYSTEM.subscribe(
            config.chainId,
            config.guard,
            OPENED_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        SYSTEM.subscribe(
            config.chainId,
            config.guard,
            ESCALATED_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        SYSTEM.subscribe(
            config.chainId,
            config.guard,
            RESOLVED_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
    }

    function react(LogRecord calldata log) external override onlySystem {
        if (log.contractAddress == CronTopics.SOURCE) {
            if (TICK_TOPIC != 0 && log.topic0 == TICK_TOPIC) _onTick();
            return;
        }

        if (log.chainId != CHAIN_ID) return;

        if (log.contractAddress == POOL) {
            if (log.topic0 == SYNC_TOPIC && log.opCode == 1) _onSync(log.data);
            return;
        }

        if (log.contractAddress == GUARD && log.opCode == 2) {
            if (log.topic0 == OPENED_TOPIC) _onOpened(log.topic1, log.data);
            else if (log.topic0 == ESCALATED_TOPIC)
                _onEscalated(log.topic1, log.data);
            else if (log.topic0 == RESOLVED_TOPIC) _onResolved(log.topic1);
        }
    }

    function coverDebt() external {
        _coverDebt();
    }

    function withdrawNative(address payable to, uint256 amount) external {
        if (msg.sender != OWNER) revert NotOwner();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit NativeWithdrawn(to, amount);
    }

    function _onSync(bytes calldata data) private {
        (uint112 reserve0, uint112 reserve1) = abi.decode(
            data,
            (uint112, uint112)
        );
        uint256 price = _price(reserve0, reserve1);
        if (price == 0) return;

        uint256 previous = lastPrice;
        lastPrice = price;
        uint64 timestamp = uint64(block.timestamp);

        if (stopDisarmed && price >= _rearmLevel()) {
            stopDisarmed = false;
            emit StopRearmed(price);
        }

        if (pendingActive) _supervise(price, timestamp);
        else _detect(price, previous, timestamp);
    }

    function _onTick() private {
        if (!pendingActive) return;
        uint64 timestamp = uint64(block.timestamp);
        if (_isStale(timestamp)) {
            _clearPending(timestamp);
            return;
        }
        _requestDefaultIfDue(timestamp, lastPrice);
    }

    function _detect(
        uint256 price,
        uint256 previous,
        uint64 timestamp
    ) private {
        if (timestamp < cooldownUntil) return;
        if (
            openRequestedAt != 0 &&
            timestamp < openRequestedAt + REQUEST_TIMEOUT
        ) return;

        IHeadsUpGuard.Trigger trigger;
        if (previous != 0 && price * BPS <= previous * (BPS - GAP_BPS)) {
            trigger = IHeadsUpGuard.Trigger.PriceGap;
        } else if (!stopDisarmed && price <= _stopLevel()) {
            trigger = IHeadsUpGuard.Trigger.StopLossProximity;
        } else {
            return;
        }

        openRequestedAt = timestamp;
        _requestCallback(
            abi.encodeCall(
                IHeadsUpGuard.openAction,
                (address(0), trigger, price)
            )
        );
        emit TriggerFired(trigger, price, previous);
    }

    function _supervise(uint256 price, uint64 timestamp) private {
        if (_isStale(timestamp)) {
            _clearPending(timestamp);
            return;
        }

        uint256 id = pendingId;

        if (!cancelSent && price * BPS >= anchorPrice * (BPS + RECOVER_BPS)) {
            cancelSent = true;
            _requestCallback(
                abi.encodeCall(
                    IHeadsUpGuard.cancelOnRecovery,
                    (address(0), id, price)
                )
            );
            emit DirectiveSent(Directive.Cancel, id, price);
            return;
        }

        if (
            !cancelSent &&
            !escalationSent &&
            price * BPS <= anchorPrice * (BPS - ESCALATE_BPS)
        ) {
            escalationSent = true;
            _requestCallback(
                abi.encodeCall(IHeadsUpGuard.escalate, (address(0), id, price))
            );
            emit DirectiveSent(Directive.Escalate, id, price);
        }

        _requestDefaultIfDue(timestamp, price);
    }

    function _requestDefaultIfDue(uint64 timestamp, uint256 price) private {
        if (
            timestamp < pendingDeadline ||
            timestamp < lastDefaultRequestAt + DEFAULT_RETRY
        ) return;
        lastDefaultRequestAt = timestamp;
        _requestCallback(
            abi.encodeCall(
                IHeadsUpGuard.defaultFromReactive,
                (address(0), pendingId)
            )
        );
        emit DirectiveSent(Directive.ExecuteDefault, pendingId, price);
    }

    function _onOpened(uint256 id, bytes calldata data) private {
        (, , uint256 price, uint64 deadline) = abi.decode(
            data,
            (uint8, uint16, uint256, uint64)
        );
        pendingActive = true;
        pendingId = id;
        anchorPrice = price;
        pendingDeadline = deadline;
        escalationSent = false;
        cancelSent = false;
        lastDefaultRequestAt = 0;
        openRequestedAt = 0;
        if (!stopDisarmed && price <= _stopLevel()) {
            stopDisarmed = true;
            emit StopDisarmed(price);
        }
        _startTicks();
        emit PendingTracked(id, price, deadline);
    }

    function _onEscalated(uint256 id, bytes calldata data) private {
        if (!pendingActive || id != pendingId) return;
        (, , uint64 deadline) = abi.decode(data, (uint16, uint256, uint64));
        pendingDeadline = deadline;
        escalationSent = true;
    }

    function _onResolved(uint256 id) private {
        if (!pendingActive || id != pendingId) return;
        _clearPending(uint64(block.timestamp));
    }

    function _clearPending(uint64 timestamp) private {
        uint256 id = pendingId;
        pendingActive = false;
        pendingId = 0;
        anchorPrice = 0;
        pendingDeadline = 0;
        escalationSent = false;
        cancelSent = false;
        lastDefaultRequestAt = 0;
        cooldownUntil = timestamp + COOLDOWN;
        _stopTicks();
        emit PendingCleared(id, cooldownUntil);
    }

    function _startTicks() private {
        if (TICK_TOPIC == 0 || tickActive) return;
        tickActive = true;
        SYSTEM.subscribe(
            block.chainid,
            CronTopics.SOURCE,
            TICK_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
    }

    function _stopTicks() private {
        if (!tickActive) return;
        tickActive = false;
        SYSTEM.unsubscribe(
            block.chainid,
            CronTopics.SOURCE,
            TICK_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
    }

    function _stopLevel() private view returns (uint256) {
        return (STOP_PRICE * (BPS + STOP_PROXIMITY_BPS)) / BPS;
    }

    function _rearmLevel() private view returns (uint256) {
        return (_stopLevel() * (BPS + REARM_BPS)) / BPS;
    }

    function _isStale(uint64 timestamp) private view returns (bool) {
        return timestamp > pendingDeadline + STALE_GRACE;
    }

    function _price(
        uint112 reserve0,
        uint112 reserve1
    ) private view returns (uint256) {
        if (reserve0 == 0 || reserve1 == 0) return 0;
        return
            RISK_IS_TOKEN0
                ? (uint256(reserve1) * PRICE_SCALE) / reserve0
                : (uint256(reserve0) * PRICE_SCALE) / reserve1;
    }

    function _requestCallback(bytes memory payload) private {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: CHAIN_ID,
                recipient: GUARD,
                gasLimit: CALLBACK_GAS,
                payload: payload
            })
        );
    }
}
