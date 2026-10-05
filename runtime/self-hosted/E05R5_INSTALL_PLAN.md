# E05R5 future owner install plan — NOT EXECUTED

This is a candidate for separately authorized owner installation. E05R4 and
E05R5 remain unpublished. No step below was run on Oracle, and no live
credentials were accessed in producing this change set.

## 1. Verify the combined successor locally

Use a clean public checkout at
`a26199e22a44a33e555726e56d7ed169148f9b96`. Verify every parent hash in the
handoff `CHANGED_FILES.json`, overlay all of `changed-files/`, and verify every
final hash. There are no deletions. Do not apply just E05R5 to public main.
Verify `runtime/SOURCE_MANIFEST.json` over the complete resulting runtime.
Use the included offline `verify-handoff.py` before transferring source.

In `runtime`, under Node 22 on Linux:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Build and test before installation. Preserve the output and confirm zero skipped
Linux tests. Run the unchanged publication checker on a clean export (no
`node_modules`, `dist`, handoff archives or test fixtures) and its reachable
public history. Review the candidate code and service unit. Publication, if
wanted, is a separate owner action; nothing here pushes GitHub.

## 2. Freeze the migration source on the VM

Only after separate authorization, stop any owner helper/scheduled task that
can refresh or rewrite the legacy VM session. Do not run the old probe,
one-shot refresh helper, or an old broker while migrating or after promotion.
The new writer lock cannot coordinate with those older helpers.

Use the *current VM-local* qualification session, existing host ID and existing
VM-local AES key. Never use a laptop transfer bundle. The packet's latest
known identity is:

| Field | Expected post-canary value |
| --- | --- |
| access expiry | 1791172095935 (`2026-10-05T03:48:15.935Z`) |
| earliest refresh | 1791171737000 (`2026-10-05T03:42:17.000Z`) |

If a later legitimate rotation has happened, these are stale. Obtain its
sanitized timing identity from the authoritative VM state, review it, and
substitute *both* values. Do not weaken the check, remove the schedule, or
normalize an unqualified legacy field in this migration. An unqualified
schedule fails closed and requires separate reviewed reconciliation.

## 3. Prepare inert installation and protected inputs

Transfer only the reviewed source plus locally built `runtime/dist` to an
owner-chosen staging directory on the VM. Check Node 22 and `/usr/bin/flock`;
the unit assumes `/usr/bin/node` (verify the existing installation path before
reviewing any path adjustment). No Docker, Cloudflare, D1 or public OCI port.

As owner/root, invoke this candidate only after review:

```sh
sh runtime/self-hosted/deploy/install-candidate.sh /absolute/reviewed/source
```

It creates an unprivileged `trognet` account if absent, inert source under
`/opt/trognet/gateway`, a candidate unit/environment, and private directories.
It refuses existing deployment/environment targets and does not start the
service or read credentials. Confirm an existing `trognet` account is dedicated
and unprivileged. Do not use the script as an upgrade/overwrite command.

Review `/etc/trognet-gateway/gateway.env` (root-owned 0600). The files referenced inside
it live in `/etc/trognet-gateway/secrets` (trognet-owned 0700), each file
trognet-owned 0600. With legacy writers stopped, make protected byte-identical
copies of the existing VM host ID and key to `host-id` and `credential-key`
there. Make a protected byte-identical copy of the *current* encrypted legacy
session to `migration-source.json` in the same directory. Hash-check those
copies locally without printing their contents. Keep the originals untouched.
If original paths already satisfy ownership/permissions, migration may read
them explicitly instead of copies. The runtime must keep using the same key
and host; never generate replacement values for them.

Generate two distinct random 32-byte base64url admission secrets *on the VM*,
write directly into `origin-admission` and `owner-admission` with 0600 mode,
and never print them, pass them as command arguments, or put them in source.
These are new gateway admission secrets, not OpenAI credentials or a new
encryption key. Keep the owner secret off any later front door.

Preserve a protected VM-local backup of the frozen originals. Do not add it to
the source/handoff, upload it to Pages, or include it in diagnostic output.

## 4. Offline migration and verification before promotion

The service remains stopped. From `/opt/trognet/gateway/runtime`, execute as the
service user (the state directory must be exactly 0700, owned by `trognet`):

```sh
sudo -u trognet /usr/bin/node self-hosted/migrate.mjs migrate \
  --session /etc/trognet-gateway/secrets/migration-source.json \
  --host-id /etc/trognet-gateway/secrets/host-id \
  --key /etc/trognet-gateway/secrets/credential-key \
  --state-dir /var/lib/trognet-gateway \
  --expected-access 1791172095935 \
  --expected-earliest 1791171737000
sudo -u trognet /usr/bin/node self-hosted/migrate.mjs verify \
  --session /etc/trognet-gateway/secrets/migration-source.json \
  --host-id /etc/trognet-gateway/secrets/host-id \
  --key /etc/trognet-gateway/secrets/credential-key \
  --state-dir /var/lib/trognet-gateway \
  --expected-access 1791172095935 \
  --expected-earliest 1791171737000
```

Substitute reviewed newer timing values only if step 2 found a newer session.
Both commands make zero network requests. Review sanitized receipts: source
hash, host hash, timing, generation 0 and `MIGRATED`/`VERIFIED`. Compare source
hash to the frozen authoritative file and confirm it has not changed before
promotion. `ALREADY_MIGRATED` is possible only for exactly the same source bytes,
token set and generation-0 destination. A conflicting or already-renewed
destination rejects; never delete it to force another import.

The migration decrypts using the reviewed envelope helper, requires outer and
inner host/client/subject consistency and required scopes, and preserves the
entire normalized current token set. Expired access alone is allowed if the
refresh token remains valid; this step never refreshes it. Retain the original
legacy file until this separate verification succeeds, then archive it locally
under owner control. Neither command deletes or overwrites it.

## 5. Owner-controlled promotion

Review the unit's hardening and log policy. Run `systemd-analyze verify` on the
candidate unit on the target host. The source task checked its syntax with a
local Node-path substitution only; target installation is still unqualified.
Then, under separately authorized promotion:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now trognet-gateway.service
curl --fail --silent http://127.0.0.1:19456/health
```

Health is local readiness only and makes no provider call. Expected shape is
just `{"ready":true}`. Confirm the listener is only `127.0.0.1:19456`; confirm
the owner socket is 0600 under `/run/trognet-gateway` 0700. No public port.
Startup logs contain only fixed labels. Never enable HTTP body/auth debug logs.
The 192 MiB V8 heap, 384 MiB service maximum and disabled runtime swap are
candidates to observe on the 1 GiB VM; 2 GiB swap is build headroom only.

## 6. Natural renewal observation, no inference

This step makes a real model catalog call and, when due, a real refresh. It is
NOT authorized by the source task. Obtain owner authorization for it later.
Before and after the next natural window, use only:

```sh
sudo -u trognet /usr/bin/node self-hosted/qualify.mjs \
  --socket /run/trognet-gateway/owner.sock \
  --secret /etc/trognet-gateway/secrets/owner-admission
```

Keep the sanitized receipts. The unchanged BrokerCore refreshes within two
minutes of access expiry, and never before its normalized provider threshold.
The observed ~six-minute lead does not make every post-threshold invocation
refresh. A pre-window call ordinarily reports `NO_REFRESH_OBSERVED`.
Qualification requires `AUTOMATIC_REFRESH_OBSERVED`, generation +1, changed
durable envelope, `persisted:true`, and successful catalog after replacement.
The command makes no inference request. A restarted staged replacement is
recovery, not proof that this invocation performed renewal.

`BLOCKED` (exit 2) preserves sanitized before/after state. `refreshing` requires
owner reconciliation; `configuration_error` requires configuration correction;
`reauth_required` requires separately authorized sign-in; stored backoff must
elapse. Do not reset phases, roll back tokens, repeatedly restart to refresh,
or replay a possibly consumed refresh token. Terminal failures and disk
uncertainty are not grounds for restoring an older envelope.

## 7. Stop at the gateway boundary

Do not configure Cloudflare or connect Cyberdeck/Portal under this plan. E06
must replace the old token-export seam, enforce owner-only intent, and define
durable end-to-end idempotency and archival of the 512-entry origin ledger.
No successful local test or catalog call qualifies those future components.

If installation must be rolled back, stop the new service and preserve its
latest complete protected state and key. Never restore an old legacy session
after any new refresh. Resume a writer only after separately reviewing which
session generation is authoritative.
