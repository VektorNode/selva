---
'@selvajs/selva': patch
'@selvajs/server': patch
---

Bump nodemailer to ^9.1.1 to clear four security advisories

9.0.6 is affected by a high-severity quadratic-time DoS in `addressparser`
(GHSA-2x7j-588g-ccc2) plus three moderate recipient-validation issues: an
IDN/Punycode allow-list bypass (GHSA-wmmp-3585-3rmp), RFC 5322 comment
mis-parsing (GHSA-cc9r-2j5m-2m83), and `resolveContent()` bypassing
`disableFileAccess`/`disableUrlAccess` on the legacy signature
(GHSA-8m3c-c648-2xjj). All four are fixed by 9.1.1; no API changes.
