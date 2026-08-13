#!/usr/bin/env bash
#
# Issue a local certificate and set up the hub's name on the network.
# Run on the Mac server. Requires mkcert: brew install mkcert
#
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null; then
  echo "mkcert is not installed. Run: brew install mkcert" >&2
  exit 1
fi

# Desired name: from .env, from the argument, or hub.local by default
HUB_HOST="${1:-$(grep -E '^HUB_HOST=' .env 2>/dev/null | cut -d= -f2 || true)}"
HUB_HOST="${HUB_HOST:-hub.local}"

LOCAL_NAME="$(scutil --get LocalHostName 2>/dev/null || echo "")"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"

echo "Hub name:            $HUB_HOST"
echo "Mac's network name:  ${LOCAL_NAME:-unknown}.local"
echo "LAN IP:              ${LAN_IP:-unknown}"
echo

# ── Name resolution ───────────────────────────────────────────────────────
#
# The .local domain is served by Bonjour, and it only answers to the
# machine's own name. An arbitrary name like hub.local won't resolve by
# itself on the Mac or on an iPad. Editing /etc/hosts helps only the Mac
# where it was edited — it's useless for iPads and phones.
#
# So the hub's name must match the Mac's network name.
#
SHORT_NAME="${HUB_HOST%.local}"

if [[ "$HUB_HOST" == *.local && "$SHORT_NAME" != "$LOCAL_NAME" ]]; then
  echo "⚠️  $HUB_HOST will not resolve from other devices."
  echo
  echo "    Bonjour only answers to the Mac's own name: ${LOCAL_NAME}.local"
  echo "    There are two ways out."
  echo
  echo "    1. Rename the Mac — then $HUB_HOST works on all devices"
  echo "       at once, with no per-device setup:"
  echo
  echo "         sudo scutil --set LocalHostName $SHORT_NAME"
  echo
  echo "    2. Use the name the Mac already has. Put in .env:"
  echo
  echo "         HUB_HOST=${LOCAL_NAME}.local"
  echo
  read -r -p "    Rename the Mac to '$SHORT_NAME' now? [y/N] " answer
  if [[ "${answer:-n}" =~ ^[Yy]$ ]]; then
    sudo scutil --set LocalHostName "$SHORT_NAME"
    LOCAL_NAME="$SHORT_NAME"
    echo "    Done: the Mac now answers to $HUB_HOST"
  else
    echo "    Leaving it as is. The certificate will be issued anyway — but keep the name in mind."
  fi
  echo
fi

# ── Certificate ───────────────────────────────────────────────────────────
mkdir -p certs
mkcert -install

# Names in the certificate: hub name, Mac name, localhost and the IP.
# Extra names don't hurt; a missing one makes the browser complain.
NAMES=("$HUB_HOST" "localhost" "127.0.0.1")
[[ -n "$LOCAL_NAME" && "$LOCAL_NAME.local" != "$HUB_HOST" ]] && NAMES+=("$LOCAL_NAME.local")
[[ -n "$LAN_IP" ]] && NAMES+=("$LAN_IP")

mkcert -cert-file certs/hub.pem -key-file certs/hub-key.pem "${NAMES[@]}"

# Keep the name for Caddy in .env so the config never needs hand-editing
if [[ -f .env ]]; then
  if grep -qE '^HUB_HOST=' .env; then
    sed -i '' -E "s|^HUB_HOST=.*|HUB_HOST=$HUB_HOST|" .env
  else
    printf '\nHUB_HOST=%s\n' "$HUB_HOST" >> .env
  fi
else
  printf 'HUB_HOST=%s\n' "$HUB_HOST" > .env
fi

cat <<TXT

Certificate issued for: ${NAMES[*]}

Next:

  1. Start Caddy:
       docker compose --profile https up -d

  2. Enable secure cookies — in .env:
       SECURE_COOKIES=true
     then restart: docker compose up -d

  3. Once per device — trust the root certificate:
       $(mkcert -CAROOT)/rootCA.pem
     Send it to iPads and iPhones via AirDrop, then
       Settings → Profile Downloaded → Install
       Settings → General → About → Certificate Trust Settings →
       enable full trust for mkcert

After that https://$HUB_HOST opens without warnings — no port needed,
443 is implied. Offline mode and the home screen icon start working:
both require a secure connection.
TXT
