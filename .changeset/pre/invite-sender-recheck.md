---
'@selvajs/server': patch
'@selvajs/selva': patch
---

An invite stops working once its sender could no longer send it. Acceptance used to check only that the sender was enabled and still in the org, so an owner or instance admin could park that authority in an invite to a second address, be demoted, and take it back within the invite's 7 days. `inviterStillVouches` now re-runs the mint gates: `manage_org_members`, the owner boundary for owner and admin invites, and `instance_admin` for platform permissions. A resent invite now names the resender as its sender, so resending after the original sender left produces a link that works. The self-update launcher writes its runner with `mktemp` instead of the fixed `/tmp/selva-update-runner.sh`, which another local account could plant and have run as the app user.
