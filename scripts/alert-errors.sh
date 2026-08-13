#!/usr/bin/env bash
# Hourly error alert for the VPS host: scan the last hour of hub container
# logs for ERROR lines and push them to an ntfy topic (or any endpoint that
# accepts a plain-text POST). Silence means no errors — the script sends
# nothing when the hour was clean.
#
# Cron on the host (see docs/deploy-vps.md, "Monitoring"):
#   5 * * * * ALERT_URL=https://ntfy.sh/<secret-topic> /srv/family-hub/app/scripts/alert-errors.sh
set -euo pipefail

ALERT_URL="${ALERT_URL:?Set ALERT_URL, e.g. https://ntfy.sh/your-secret-topic}"
SINCE="${SINCE:-1h}"
CONTAINERS="${CONTAINERS:-family-hub family-hub-demo}"

for container in $CONTAINERS; do
  # The demo overlay is optional — skip containers that do not exist
  docker inspect "$container" >/dev/null 2>&1 || continue

  # App log lines look like "12:34:56 ERROR ..." — anchor on that shape
  # so the word ERROR inside user data never triggers a false alarm.
  errors=$(docker logs --since "$SINCE" "$container" 2>&1 |
    grep -E '^[0-9]{2}:[0-9]{2}:[0-9]{2} ERROR' | tail -20 || true)
  [ -z "$errors" ] && continue

  curl -fsS -m 10 \
    -H "Title: $container: errors in the last $SINCE" \
    -H "Priority: high" \
    --data-raw "$errors" \
    "$ALERT_URL" >/dev/null
done
