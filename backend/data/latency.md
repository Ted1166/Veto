| Scenario | Action | Trigger | Outcome | Origin to reactive | Reactive to callback | End to end | Window left | Deadline to resolved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| timeout | 1 | PriceGap | Defaulted | 0s | 1s | 1s (6 blocks, ~1.2s) | 59s | 4s |
| approve | 2 | PriceGap | Approved | 0s | 2s | 2s (9 blocks, ~1.8s) | 58s | n/a |
| veto | 3 | PriceGap | Vetoed | 0s | 1s | 1s (4 blocks, ~0.8s) | 59s | n/a |
| approve | 4 | PriceGap | Approved | 0s | 2s | 2s (9 blocks, ~1.8s) | 58s | n/a |
| veto | 5 | PriceGap | Vetoed | 0s | 1s | 1s (6 blocks, ~1.2s) | 59s | n/a |
| timeout | 6 | PriceGap | Defaulted | 0s | 2s | 2s (8 blocks, ~1.6s) | 58s | 3s |
| recover | 7 | PriceGap | Cancelled | 0s | 1s | 1s (5 blocks, ~1.0s) | 59s | n/a |
| timeout | 8 | PriceGap | Defaulted | 0s | 1s | 1s (6 blocks, ~1.2s) | 59s | 9s |
| approve | 9 | PriceGap | Approved | 0s | 2s | 2s (8 blocks, ~1.6s) | 58s | n/a |

End to end over 9 actions by block timestamp: min 1s, mean 1.4s, max 2s. Estimated from block counts at 200ms per block: min 0.8s, mean 1.4s, max 1.8s.

The reactive chain and the origin chain stamp blocks with different clocks. Where a reactive block is stamped earlier than the swap that caused it, that hop is shown as 0s and the difference is taken out of the callback hop. End to end is measured on the origin chain alone and is unaffected.

| Action | Origin swap | Reactive transaction | Callback transaction | Decision | Default requested |
| --- | --- | --- | --- | --- | --- |
| 1 | 0x8976b699...51ddc8 | 0xcb68d669...7128c8 | 0x295e5af1...46d9fb | none | 0xa898801f...580531 |
| 2 | 0x326a98ac...562d29 | 0x95c57241...0a14a6 | 0x8149f0df...a08cd7 | approve 0x911bd736...33e7c9 | n/a |
| 3 | 0x5b2ee610...ec5734 | 0xf8436b51...cfd7db | 0x626035b4...17b6bb | veto 0x835d4818...06bc34 | n/a |
| 4 | 0x7713f2a1...7cf6bc | 0x1f0e0cd2...b1e36e | 0xb13c5856...170df9 | approve 0x0eb90b28...c781e1 | n/a |
| 5 | 0x9d57e486...471094 | 0x160ed608...500826 | 0x66acc2a5...0e7bce | veto 0x4a010270...0bf70d | n/a |
| 6 | 0x90a30f83...224b77 | 0x8299a2e3...acb525 | 0x87c430a7...cb7750 | none | 0xf1f6b62a...6c131b |
| 7 | 0x9466d0d5...785235 | 0x25d25b25...c86b3d | 0x53230075...2a5059 | recovery buy 0xce36d0da...b4373e | n/a |
| 8 | 0x72cd1782...59a085 | 0x3f4082ab...46a66b | 0x7fecd544...5b6601 | none | 0xba80046a...7dc164 |
| 9 | 0xa7bf2a2a...756229 | 0x0f173a81...7e95f1 | 0xf0a78c08...a623ef | approve 0x68c05186...fce715 | n/a |