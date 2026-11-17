// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

interface IHeadsUpGuard {
    enum Trigger {
        StopLossProximity,
        PriceGap
    }

    enum Status {
        None,
        Pending,
        Approved,
        Resized,
        Vetoed,
        Defaulted,
        Cancelled
    }

    struct Action {
        Trigger trigger;
        Status status;
        bool escalated;
        uint16 proposedBps;
        uint16 executedBps;
        uint64 openedAt;
        uint64 deadline;
        uint64 resolvedAt;
        uint256 triggerPrice;
        uint256 latestPrice;
        uint256 stableReceived;
    }

    event ActionOpened(
        uint256 indexed id,
        Trigger trigger,
        uint16 proposedBps,
        uint256 triggerPrice,
        uint64 deadline
    );
    event ActionEscalated(
        uint256 indexed id,
        uint16 proposedBps,
        uint256 price,
        uint64 deadline
    );
    event ActionResolved(
        uint256 indexed id,
        Status status,
        uint16 executedBps,
        uint256 stableReceived
    );
    event OpenIgnored(uint256 activeId, uint256 price);

    error NotOwner();
    error InvalidConfig();
    error InvalidBps(uint16 bps);
    error NotPending(uint256 id);
    error DecisionWindowClosed(uint256 id, uint64 deadline);
    error DeadlineNotReached(uint256 id, uint64 deadline);

    function openAction(address rvm, Trigger trigger, uint256 price) external;
    function escalate(address rvm, uint256 id, uint256 price) external;
    function cancelOnRecovery(address rvm, uint256 id, uint256 price) external;
    function defaultFromReactive(address rvm, uint256 id) external;

    function approve(uint256 id) external;
    function resize(uint256 id, uint16 bps) external;
    function veto(uint256 id) external;
    function executeDefault(uint256 id) external;

    function getAction(uint256 id) external view returns (Action memory);
}
