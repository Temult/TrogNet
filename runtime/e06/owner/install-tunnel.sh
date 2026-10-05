#!/bin/sh
# OWNER ONLY. Inert installation; no service start, DNS, credential or firewall action.
set -eu
[ "$(id -u)" = 0 ] || exit 1
[ "$#" = 2 ] || exit 1
source_dir=$(realpath -- "$1")
config=$(realpath -- "$2")
[ -x /usr/local/bin/cloudflared ] || exit 1
[ -f "$source_dir/trognet-tunnel.service" ] || exit 1
[ -f "$config" ] && [ ! -L "$config" ] || exit 1
# Only exact reviewed template substitutions are accepted.
python3 - "$source_dir/cloudflared.example.yml" "$config" <<'PY'
import pathlib,re,sys
template=pathlib.Path(sys.argv[1]).read_text()
config=pathlib.Path(sys.argv[2]).read_text()
t=re.search(r'^tunnel: ([a-f0-9-]{36})$',config,re.M)
h=re.findall(r'^  - hostname: ([a-z0-9.-]+)$',config,re.M)
if not t or not re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',t[1]) or len(h)!=2 or h[0]!=h[1] or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}',h[0]) or h[0].endswith('.invalid'):
    sys.exit(1)
expected=template.replace('REPLACE_ME_TUNNEL_UUID',t[1]).replace('REPLACE_ME_ORIGIN_HOSTNAME',h[0])
sys.exit(0 if config==expected else 1)
PY
/usr/local/bin/cloudflared --config "$config" tunnel ingress validate >/dev/null
[ -f /etc/cloudflared-trognet/tunnel.json ] || exit 1
[ ! -L /etc/cloudflared-trognet/tunnel.json ] || exit 1
[ ! -L /etc/cloudflared-trognet ] || exit 1
[ "$(stat -c '%U:%G:%a' /etc/cloudflared-trognet)" = 'root:root:755' ] || exit 1
id trognet-tunnel >/dev/null 2>&1 || useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin trognet-tunnel
# Existing divergent files require explicit owner reconciliation, never overwrite.
for pair in config unit; do
  if [ "$pair" = config ]; then from=$config; to=/etc/cloudflared-trognet/config.yml; else from=$source_dir/trognet-tunnel.service; to=/etc/systemd/system/trognet-tunnel.service; fi
  [ ! -L "$to" ] || exit 1
  if [ -e "$to" ]; then cmp -s -- "$from" "$to" || exit 1; fi
done
[ "$(stat -c '%U:%G:%a' /etc/cloudflared-trognet/tunnel.json)" = 'trognet-tunnel:trognet-tunnel:600' ] || exit 1
install -o root -g root -m 0644 "$config" /etc/cloudflared-trognet/config.yml
install -o root -g root -m 0644 "$source_dir/trognet-tunnel.service" /etc/systemd/system/trognet-tunnel.service
printf '%s\n' 'TUNNEL_ARTIFACTS_INSTALLED_NOT_STARTED'
