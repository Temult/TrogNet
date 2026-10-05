# E06 — read me first

This is the local E06 candidate rooted at public parent
07569eef742c242994b950c6e982d86d4f6dfc04. It has not been committed, pushed, deployed or
live-qualified. Read EXECUTIVE_SUMMARY, CURRENT_BASELINE, architecture/threat model,
request identity, tests and OPEN_BOUNDARIES before owner execution.

Use source/ in the final handoff as the complete clean candidate. CHANGED_FILES.json
identifies the exact proposed delta and binds bytes/SHA-256. The package also contains
the full deterministic test transcript, source/build manifests and publication check.
Reproduce from runtime/ using npm ci --ignore-scripts --no-audit --no-fund and npm test
under Linux Node 22. Tests use synthetic providers; never point them at live services.

The owner kit is prepared for review with placeholders. No real configuration or secrets
are embedded. OWNER_EXECUTION_ORDER and owner/OWNER_KIT.md specify the future sequence.
Gate 5I has independently completed PASS and its sanitized owner receipt is included in the reconciled handoff. Do not reproduce it or rotate again merely to reconfirm it.

The irreversible replay boundary is the owner-enabled sequence fence: never restore an
older request state, DO namespace or credential envelope. Before adoption, review the
archival protocol and the 2048-attempt front-door hard stop. Roll back product routing to
the extractive Portal while retaining the newest protected state.

## NOT EXECUTED

E06 Oracle/SSH mutation, E06 live gateway routes, OAuth/login operations initiated by E06, Cloudflare account
or deployment actions, DNS/D1/OCI/Tailscale changes, public SSH closure, live inference,
inference spending, commits or pushes. The optional toolkit supplied no extra authority.
