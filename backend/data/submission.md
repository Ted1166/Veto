| Scenario | Action | Trigger | Outcome | Origin to reactive | Reactive to callback | End to end | Window left | Deadline to resolved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| approve | 9 | PriceGap | Approved | 0s | 2s | 2s (8 blocks, ~1.6s) | 58s | n/a |
| veto | 5 | PriceGap | Vetoed | 0s | 1s | 1s (6 blocks, ~1.2s) | 59s | n/a |
| timeout | 8 | PriceGap | Defaulted | 0s | 1s | 1s (6 blocks, ~1.2s) | 59s | 9s |
| recover | 7 | PriceGap | Cancelled | 0s | 1s | 1s (5 blocks, ~1.0s) | 59s | n/a |

End to end over 4 actions by block timestamp: min 1s, mean 1.3s, max 2s. Estimated from block counts at 200ms per block: min 1.0s, mean 1.3s, max 1.6s.

The reactive chain and the origin chain stamp blocks with different clocks. Where a reactive block is stamped earlier than the swap that caused it, that hop is shown as 0s and the difference is taken out of the callback hop. End to end is measured on the origin chain alone and is unaffected.

| Action | Origin swap | Reactive transaction | Callback transaction | Decision | Default requested |
| --- | --- | --- | --- | --- | --- |
| 9 | [0xa7bf2a2a...756229](https://sepolia.basescan.org/tx/0xa7bf2a2a627cf45aa9f77ed2ed7615eb2cee0c0b6ee00aad9840609429756229) | `0x0f173a816eb7c863de80304883446c09c341d56db897d826f12e23336e7e95f1` | [0xf0a78c08...a623ef](https://sepolia.basescan.org/tx/0xf0a78c0843a0d58618d94e8273df05cb1a9d9bacd644cc3909c195e6c0a623ef) | approve [0x68c05186...fce715](https://sepolia.basescan.org/tx/0x68c051866cff94ebf6f65faa7fa38505c8f69395bff252932aef4e45a2fce715) | n/a |
| 5 | [0x9d57e486...471094](https://sepolia.basescan.org/tx/0x9d57e4867ee07f832c188d3e2a3f4c6ff04a6179972f7bc323307b5737471094) | `0x160ed6088eba19c0f98fec2ee907c3d5400e817230ab8071f7b3ad7057500826` | [0x66acc2a5...0e7bce](https://sepolia.basescan.org/tx/0x66acc2a5968f6dc113ded63be1081ba65004d3fcacadf5c305c6b909050e7bce) | veto [0x4a010270...0bf70d](https://sepolia.basescan.org/tx/0x4a010270f15ae89c99a993c23657028ca09a6d4a817dbb2360eea2a0a10bf70d) | n/a |
| 8 | [0x72cd1782...59a085](https://sepolia.basescan.org/tx/0x72cd178210134eb468e44b1fe627e0a2f3f716461818a17f199fee175859a085) | `0x3f4082ab2f79107d9790b3ad3461311aa8a0b87805b71db772509f622146a66b` | [0x7fecd544...5b6601](https://sepolia.basescan.org/tx/0x7fecd544f4737c4a26bd07a44880ab34720a94ed50e4075c0b79d2f9325b6601) | none | `0xba80046aa9801b32bb8267e518b6f2136bce58719bb3dd2d1fcccc505d7dc164` |
| 7 | [0x9466d0d5...785235](https://sepolia.basescan.org/tx/0x9466d0d59298a815ccc34e964582dbf99b50e84a308ebc1580ad4981c4785235) | `0x25d25b253d6976d7e2f13b527bb420f0d55b5d297753810a57a2f63022c86b3d` | [0x53230075...2a5059](https://sepolia.basescan.org/tx/0x53230075f8863e85414ba810b1d55246f13a85e8e5422bb2c2334ef7652a5059) | recovery buy [0xce36d0da...b4373e](https://sepolia.basescan.org/tx/0xce36d0da62271ff2a8624001799d72e1c7eb156fa76fbc57a0030d9a00b4373e) | n/a |

All 9 recorded actions. End to end over 9 actions by block timestamp: min 1s, mean 1.4s, max 2s. Estimated from block counts at 200ms per block: min 0.8s, mean 1.4s, max 1.8s.