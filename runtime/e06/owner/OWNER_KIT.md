# E06 owner hardening and Tunnel kit — PREPARED, NOT RUN

This is a reviewable owner procedure, not authorization to operate a host. No supplied
script starts a service, authenticates, changes DNS, closes SSH or runs inference.
Do not paste secrets into chat. Keep all real configuration and receipts outside source.

## Preconditions and preservation

Review the exact parent and changed-file hashes. Verify the included independent Gate 5I PASS receipt.
The v2 snapshot reports generation 1; do not assume that is still current. Never restore
an older credential envelope. Do not run the old broker, migration source or renewal
scripts. Gate 5I has already reported PASS; leave it alone and preserve the receipt.

Keep the active SSH session and a second recovery path open. Verify OCI console access
and record the exact existing NSG/security-list ingress rule identifiers privately.
Do not terminate/recreate the small VM. No public application port or load balancer.

## Tailscale administration

Use the official Ubuntu installation instructions linked below; inspect the repository
signing key and package origin before installing a pinned reviewed version. Prefer
package-manager installation; this kit intentionally supplies no curl-pipe-shell.
Owner commands after package review: `sudo apt-get install tailscale`, then
`sudo systemctl enable --now tailscaled`, then `sudo tailscale up` with the owner's
reviewed tailnet policy. Authentication happens privately on the owner's device.
No auth key is embedded or requested here. Do not advertise an exit node or subnet.

Use the existing OpenSSH daemon over the tailnet address; Tailscale SSH is optional and
requires its own policy review. Grant only the owner administrative reachability.
On the VM run `tailscale status` and `tailscale ip -4` privately. From a SECOND owner
terminal on the tailnet run `ssh ubuntu@<tailnet-address>` using the existing local key,
verify the host fingerprint, execute `id`, `sudo -n true`, and reconnect successfully.
Also test after a tailscaled service restart while retaining the original public session.
Record only `{tailscale_connected:true, ssh_over_tailnet:true, sudo:true,
reconnect:true, host_key_verified:true}` in a sanitized receipt; no addresses/keys.

Only after every field passes, the OWNER removes public TCP/22 ingress in ALL applicable
OCI security lists and NSGs (both IPv4 and IPv6, and any broad all-TCP/all-protocol rules
that implicitly allow SSH). Do not delete unrelated rules. From an external non-tailnet
machine confirm public SSH fails; from the tailnet confirm SSH still succeeds.
A failure means STOP: use the retained session/OCI console to restore only the reviewed
previous rule, repair tailnet access, and repeat verification. No script here changes
OCI networking or host firewall rules. TCP/19456 is never opened.

## Source update and permanent replay fence

Build the reviewed runtime OFF the small VM under Linux Node 22; verify generated dist
against that build. Use a new root-owned release directory, not a copy of VM-local state.
Disable front-door inference and drain gateway work before the planned owner service
stop. Preserve the current protected state in place. Deploy the reviewed gateway,
protected-store and E06 source alongside its matching dist; preserve trognet account,
0700/0600 state/secrets, systemd hardening and the observed /usr/local/bin/node drop-in.
Do not replace the current environment or copy the old E05 installer onto this host.

With the service stopped and no writer, create a separate trognet-owned 0700 archive
directory. As trognet, run once using reviewed source:

```
/usr/local/bin/node runtime/e06/archive-ledger.mjs \
  --permanently-close-legacy-ids \
  --state-dir /var/lib/trognet-gateway \
  --archive-file /var/lib/trognet-request-archive/legacy-v1.json
```

The tool takes the same writer lock, never decrypts credentials, fsyncs the archive and
atomically enables the permanent fence. A matching rerun reports ALREADY_ENABLED;
a different archive refuses. A failed/ambiguous write means STOP and inspect durable
state with the reviewed code, never reset it. Archive includes request hashes and
reservation timestamps only. Keep it private. Restart the reviewed gateway, check
systemd/listener/readiness and state permissions. No /qualify or provider call here.

## Tunnel preparation and narrow routing

Owner installs a pinned cloudflared binary from the official distribution after hash
verification at `/usr/local/bin/cloudflared`. Create a dedicated `trognet-tunnel` system
account. Locally managed Tunnel registration and DNS are separate owner actions, done
privately with the owner's Cloudflare account. Preserve the credential JSON on Oracle
only; it is a Tunnel credential, never an OpenAI credential. Use root:root 0755
`/etc/cloudflared-trognet`, with `tunnel.json` owned by trognet-tunnel, mode 0600.
Do not share that JSON or tunnel registration certificate in a receipt.

Fill only UUID and hostname placeholders in `cloudflared.example.yml`. The inert
`install-tunnel.sh <kit-directory> <rendered-config>` requires exact template shape,
checks cloudflared ingress validation, refuses divergent existing installed files,
and installs a root-owned config/unit. It does not daemon-reload, enable or start.

For the initial health-only qualification, owner stages a separately reviewed temporary
config with ONLY the exact /health rule and terminal 404 rule; no application rules.
The strict installer intentionally refuses this modified config. Review and install that
health-only config manually under the same permissions, then owner daemon-reloads and
starts the Tunnel. Check `/health` through the intended hostname (readiness only), and
verify `/qualify`, `/token`, arbitrary paths and `/responses` return 404. Preserve status
booleans only. Then stop Tunnel, review the final exact template, remove only the reviewed
health-only config after preserving its copy, and use the inert installer for the final
configuration. Owner enables/starts only after explicit route review.

Final ingress permits exact /health, /models and /responses paths at 127.0.0.1:19456.
Methods and origin admission remain enforced by the gateway. The final catch-all is
404. The service cannot access owner socket, protected broker state or credential files.
No ingress rule may use unix:, SSH, a wildcard path, public app port or another service.
Direct origin /models and /responses without admission must be 403, never an inference
probe. Do not test authenticated /responses until the single authorized qualification.

The dedicated origin hostname can be publicly resolvable: admission is still required.
Do not forward browser Access cookies there. Keep browser Access protection on the
separate app hostname. The origin hostname is not a second browser application.

## Worker and Access configuration

Build dist locally; use the separate wrangler.e06.example.json. Keep old Portal routes,
D1 and extractive entrypoint untouched. Review Worker route /e06/* on the chosen app
hostname, workers.dev disabled and preview URLs disabled. Configure Access for ONLY
the owner, no bypass/service-token inclusion. Worker independently validates RS256,
issuer, application audience, expiry, type=app and exact owner subject using pinned
PUBLIC Access signing JWKs. Obtain public keys from the team's /cdn-cgi/access/certs;
never use a key URL supplied by an incoming JWT. Update pins through a reviewed owner
change when Cloudflare rotates keys; stale pins fail closed. Use bounded 1-8 public keys.

Bind REQUESTS to one permanent SQLite Durable Object namespace. Never rename its object
key, delete/reset the namespace, restore old data, or switch to a new namespace to bypass
exhaustion. Do not configure alarms/queues/retry rules. The only Cloudflare secret allowed
from this gateway is ORIGIN_ADMISSION, transferred privately by the owner. Never place
owner admission, provider access/refresh tokens, encryption key or protected state in
Cloudflare. Set ENABLED=true only after placeholders, binding, paths and secrets are
reviewed. No live deployment command has been run in this task.

Disable payload/header logging, traces, debug capture and sampled HTTP logs for this
Worker/Tunnel path. Preserve fixed-label gateway logs only. Cloudflare platform metadata
retention is an owner policy decision; do not collect request bodies or authentication
headers. Do not export browser HAR files containing cookies/JWTs.

## Verification and resources

Owner checks `systemctl is-active trognet-gateway`, `systemctl cat trognet-gateway`,
`ss -ltnp`, `stat` on deployment/state/socket and `systemd-analyze security` privately.
Expected: HTTP exactly 127.0.0.1:19456; owner.sock 0600 inside 0700 run directory;
root-owned source; trognet state/secrets; distinct Tunnel account. Check Tunnel routes
with `cloudflared --config <config> tunnel ingress validate` and
`cloudflared --config <config> tunnel ingress rule https://<origin>/qualify` (404 rule).
Verify /models succeeds only through the authenticated Worker, using its UI button.

Gateway memory remains High=256M, Max=384M, SwapMax=0. Tunnel candidate High=96M,
Max=160M, SwapMax=0; resource sufficiency is NOT live-qualified. On the roughly 1-GiB VM,
measure RSS/cgroup peaks, free memory and pressure before inference. Build off-host; do
not relax gateway swap to accommodate builds. Review tailscaled/system overhead and
logs. OOM/restart is a STOP, not permission to replay. Gateway restart backoff unchanged.

Sanitized receipt fields: source_manifest_sha256, gateway_listener_loopback,
owner_socket_private, source_root_owned, state_private, tailscale_ssh_verified,
public_ssh_closed, tunnel_health_ok, tunnel_forbidden_routes_404, direct_origin_denied,
worker_unauthenticated_denied, worker_nonowner_denied, visible_model_count,
no_api_key_or_credits_fallback_reviewed, memory_review_pass, timestamp. No actual values
are asserted by this package.

## Rollback

Before fence: revert source only if schema-compatible, keeping the HIGHEST protected
credential generation. After fence: never downgrade to E05 code that lacks fence support.
Stop/disable the new Worker/Tunnel route and resume the untouched extractive Portal.
Keep current gateway code and state intact, or stop the gateway. Never restore old DO
storage, request ledger, token envelopes or migration copies. Retain Tailscale; restore
public SSH only if necessary for recovery through the reviewed previous OCI rule.
Rollback of networking never authorizes request or credential replay.

## Official references consulted

- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Durable Object transactions](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/)
- [Tunnel ingress configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)
- [Tailscale Linux installation](https://tailscale.com/docs/install/linux)
- [Tailscale SSH policy](https://tailscale.com/docs/features/tailscale-ssh)

These references inform the templates; they do not establish this account's configuration,
free-tier availability, policy or live behavior. Check owner-selected versions at execution.

### Qualification path correlation command (owner only, not run here)

Immediately before and after the one authorized attempt, as trognet:

```
/usr/local/bin/node runtime/e06/owner/fence-status.mjs --state-dir /var/lib/trognet-gateway
```

The helper reads only the atomic protected-state snapshot, does not decrypt, and emits
only fence metadata. It does not lock, mutate, contact the socket/provider, or establish
inference by itself. Require high_water to advance by exactly one during the isolated
qualification and match last_gateway_request_sha256 to the browser completion receipt.
No other inference work may run during this qualification interval. Correlate with the
reviewed installed gateway/Worker hashes and exact Tunnel ingress configuration. A
reservation without completed browser/DO evidence remains uncertain, never PASS.
