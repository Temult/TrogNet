# Final deterministic test results

Platform: real Linux via local WSL2, x86_64, kernel
6.6.87.2-microsoft-standard-WSL2. Runtime: Node v22.23.3. Compiler: locked TypeScript
5.8.3. Run date: 2026-10-05. Command from runtime/: `npm test`.

| Suite | Tests | Pass | Fail | Skipped | Cancelled |
|---|---:|---:|---:|---:|---:|
| Existing E05/public-reader baseline | 209 | 209 | 0 | 0 | 0 |
| Added E06 | 93 | 93 | 0 | 0 | 0 |
| Final combined run | 302 | 302 | 0 | 0 | 0 |

Final measured duration: 11191.134565 ms as reported by Node. No unexpected skips.
The full TAP transcript is TEST_TRANSCRIPT.log at the handoff root. Local network guard
blocks default external fetch. Synthetic injected providers and permitted loopback HTTP
exercise the runtime; no live provider inference, refresh or credential access occurred.

Covered: signed JWT authentication/non-owner/expiry/issuer/audience/signature/key-URL;
forged origin/owner/request headers; Origin/Cookie/CSRF and header count/size; malformed,
UTF-8, oversized and unsupported payloads; generic proxy, token, owner and unsupported
routes; duplicate IDs/intents and canonical ordering; explicit new-attempt consent;
caller disconnect before/after dispatch; origin/Worker deadline and late gateway catalog;
Tunnel failure before/after reservation (injected); provider HTTP rejection/transport
ambiguity; protected-store restart, actual child-process death and four fsync crash points;
Worker instance recreation against persisted transactional test storage; result commit
acknowledgment loss; archival, legacy exhaustion and sequence replay after compaction;
legacy ID collision with sequence format; front-door exhaustion; output/log redaction;
unexpected upstream shape/type/size; no fallback config; one-shot qualification, local
storage failures, receipt correlation and generated browser module syntax.

The combined end-to-end fixture exercises the actual frontDoor and coordinator source,
a real loopback HTTP gateway, real protected store/BrokerCore with synthetic encrypted
tokens, and a synthetic provider. It confirms one completion and no second inference
on replay. Existing E05R4 rotation and E05R5 filesystem tests are included unchanged;
E05R6's large-catalog regression remains green.

`sh -n runtime/e06/owner/install-tunnel.sh`: PASS (syntax only; not executed).
`git diff --check` and publication/source hashes are reported separately in
SOURCE_PUBLICATION_VERIFICATION.json. No deployment tool, owner installer or live
qualification harness was run.

Limits: Node tests model Cloudflare storage transactions and Worker restart, not real
Cloudflare scheduling/storage/Access policy or real Tunnel outages. Owner browser UI
module was syntax checked and its logic tested; no deployed browser/UI session was used.
Memory/cgroup settings were reviewed as templates, not measured on Oracle. These tests
do not establish E06 LIVE_QUALIFIED, billing entitlement, independent security audit,
publication acceptance, or player-answer usefulness.
