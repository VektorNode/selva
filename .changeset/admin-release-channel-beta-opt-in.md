---
'@selvajs/selva': minor
---

Add an admin-selectable **release channel** so instances can opt into beta builds and revert to stable.

- **Admin → System → Release channel**: instance admins (`manage_updates`) choose **Stable** (npm `latest`) or **Beta** (npm `beta` dist-tag). The choice persists to `selva-channel.json` in the deployment dir so both the app and the update runner read it; absent/invalid ⇒ Stable (the historic default).
- **Switch-only**: changing the channel doesn't update anything — the operator then runs **Application Update**, which installs `@selvajs/{cli,selva}` pinned to the chosen channel's dist-tag.
- **Beta → Stable revert** works the same way and correctly downgrades: the update runner now `npm install`s the channel-tagged version instead of `npm update` (which can only move forward), so reverting from a beta lands on the older stable release. The existing health-probe + rollback still guards a bad install.
- The update-availability check and badge on **Admin → System** now reflect the selected channel (beta-aware semver ordering surfaces `beta.1 → beta.2` and beta→stable promotions; stable-channel behavior is unchanged).
