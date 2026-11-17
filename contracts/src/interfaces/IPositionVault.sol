// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

interface IPositionVault {
    function owner() external view returns (address);
    function reduce(uint16 bps) external returns (uint256 stableReceived);
}
