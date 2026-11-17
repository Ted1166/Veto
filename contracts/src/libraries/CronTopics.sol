// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

library CronTopics {
    address internal constant SOURCE =
        0x0000000000000000000000000000000000fffFfF;

    uint256 internal constant CRON_1 =
        0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;
    uint256 internal constant CRON_10 =
        0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;
    uint256 internal constant CRON_100 =
        0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;
    uint256 internal constant CRON_1000 =
        0xe20b31294d84c3661ddc8f423abb9c70310d0cf172aa2714ead78029b325e3f4;
    uint256 internal constant CRON_10000 =
        0xd214e1d84db704ed42d37f538ea9bf71e44ba28bc1cc088b2f5deca654677a56;

    function isValid(uint256 topic) internal pure returns (bool) {
        return
            topic == 0 ||
            topic == CRON_1 ||
            topic == CRON_10 ||
            topic == CRON_100 ||
            topic == CRON_1000 ||
            topic == CRON_10000;
    }
}
