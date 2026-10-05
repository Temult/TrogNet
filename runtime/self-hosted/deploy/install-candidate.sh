#!/bin/sh
# Owner-reviewed candidate. This prepares inert artifacts; never starts a service,
# migrates credentials, generates keys, installs packages, or opens network ports.
set -eu
[ "$(id -u)" = 0 ] || exit 1
[ "$#" = 1 ] || exit 1
source_dir=$(realpath -- "$1")
[ -f "$source_dir/runtime/dist/credential-broker.js" ] || exit 1
[ -f "$source_dir/runtime/self-hosted/serve.mjs" ] || exit 1
[ -x /usr/bin/node ] && [ -x /usr/bin/flock ] || exit 1
/usr/bin/node -e 'if(Number(process.versions.node.split(".")[0])!==22)process.exit(1)'
# Refuse to overwrite an existing deployment or its environment.
[ ! -e /opt/trognet/gateway ] || exit 1
[ ! -e /etc/trognet-gateway/gateway.env ] || exit 1
if ! id trognet >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin trognet
fi
install -d -o root -g root -m 0755 /opt/trognet/gateway/runtime
cp -R -- "$source_dir/runtime/dist" "$source_dir/runtime/self-hosted" /opt/trognet/gateway/runtime/
cp -- "$source_dir/runtime/package.json" /opt/trognet/gateway/runtime/
chown -R root:root /opt/trognet/gateway
find /opt/trognet/gateway -type d -exec chmod 0755 {} +
find /opt/trognet/gateway -type f -exec chmod 0644 {} +
if [ ! -d /etc/trognet-gateway ]; then install -d -o root -g root -m 0755 /etc/trognet-gateway; fi
install -d -o trognet -g trognet -m 0700 /etc/trognet-gateway/secrets /var/lib/trognet-gateway
install -o root -g root -m 0600 "$source_dir/runtime/self-hosted/deploy/gateway.env.example" /etc/trognet-gateway/gateway.env
install -o root -g root -m 0644 "$source_dir/runtime/self-hosted/deploy/trognet-gateway.service" /etc/systemd/system/trognet-gateway.service
printf '%s\n' 'CANDIDATE_INSTALLED_NOT_STARTED'
