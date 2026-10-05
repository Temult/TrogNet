# E06R1 owner kit — future actions, NOT_RUN

Use ../OWNER_EXECUTION_ORDER.md as the authoritative sequence. E06R1 changes the Worker
transport only. Owner reports gateway, permanent fence, generation-2 authority,
Tailscale-only administration and healthy remotely managed trognet-origin already live.
Do not repeat original E06 host setup or modify its credentials, token, fence or services.

## Configuration contract

Browser: https://trognet-e06-owner-front-door.valateve.workers.dev, Cloudflare Access
owner-only protection plus Worker JWT validation. Production workers.dev is enabled;
preview URLs are disabled. ENABLED remains false in the source example. Replace Access
issuer/audience/subject/public-key placeholders privately; never commit private config.

Worker -> PRIVATE_GATEWAY.fetch -> existing Workers VPC Service trognet-gateway
(01a10c6d-8025-7163-a6b9-c87a58e11918) -> trognet-origin -> intended HTTP
127.0.0.1:19456. Owner must independently verify all service target fields before live
inference. The synthetic http://private-gateway.invalid host is only Request URL/Host
input; it neither performs public DNS routing nor chooses the target. No VPC Network
binding, custom DNS zone, public origin hostname or DNS route is required.

Only exact /models and /responses are emitted by the coordinator. A VPC Service target
is not a path ACL: the unchanged gateway still enforces methods, routes and admission.
Do not rely on old public-hostname ingress rules to protect the private service.
ORIGIN_URL must be absent, including any dashboard secret/override. Missing/noncallable
PRIVATE_GATEWAY fails closed; binding failure never falls back to public fetch.
ORIGIN_ADMISSION is the only gateway admission secret permitted in Worker. Never put
provider credentials, owner admission, encryption keys or protected state in Cloudflare.
Keep logs, traces, payload/header capture and preview URLs disabled. No HAR exports.

## Historical files, not E06R1 procedures

cloudflared.example.yml, install-tunnel.sh and trognet-tunnel.service are preserved
historical locally managed public-hostname templates. DO NOT apply them to the remotely
managed trognet-origin connector. They are not E06R1 deployment inputs. Do not create
DNS, rerun host installers, change SSH or re-enable archival. The gateway deadline
repair, permanent fence and protected-store code remain unchanged from the exact parent.

## Owner evidence and qualification

Follow the ordered review/deployment/enablement sequence in ../OWNER_EXECUTION_ORDER.md.
Workers VPC is beta; source tests do not qualify actual service routing, Access policy,
DO storage, account availability, resource limits or live inference. Verify the effective
configuration, not just the example or service existence/metrics. Check public JWK
rotation and exact owner claims; stale pins fail closed with no online key fetch.

Under a separately authorized qualification, before/after the single attempt as trognet:

```
/usr/local/bin/node runtime/e06/owner/fence-status.mjs --state-dir /var/lib/trognet-gateway
```

This reads fence metadata without decrypting or changing state. Match the single
high_water advance and last_gateway_request_sha256 with browser/DO completion and
installed source/Access/VPC target evidence. Reservation alone does not prove inference.
On ambiguity STOP and reconcile GET-only; never reset storage, replay or restore state.

Sanitized evidence: candidate/source manifest hashes, service ID and target-match
booleans, connector health, Access denial results, preview-disabled status, namespace
continuity, no-fallback review, catalog count (only when separately authorized), memory
review and correlation receipt. Do not expose credentials, tokens, cookies or raw output.

Rollback: disable E06 Worker and resume unchanged extractive Portal. Preserve current
gateway, remotely managed tunnel, generation-2 authority, request fence and DO ledger.
No networking rollback permits request or credential replay.

## Official reference basis

- [Workers VPC binding API](https://developers.cloudflare.com/workers-vpc/api/): Service
  configuration fixes the target regardless of the fetch URL host.
- [VPC Service configuration](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/):
  vpc_services binding/service_id schema; Workers VPC beta boundary.

Public documentation search informed this source repair. No account/API/deployment or
live gateway/provider endpoint was accessed. Documentation does not verify this account.
