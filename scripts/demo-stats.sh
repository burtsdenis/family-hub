#!/usr/bin/env bash
# Demo usage report: sessions, engagement, referrers, modules touched.
# The stats live in demo-stats.db next to the demo container's data
# (see server/src/lib/demo-stats.ts). Run inside the demo container:
#
#   ssh <vps> docker exec family-hub-demo bash scripts/demo-stats.sh
#
# or against a local copy of the file:
#
#   scripts/demo-stats.sh path/to/demo-stats.db
set -euo pipefail

DB="${1:-${DATA_DIR:-/data}/demo-stats.db}"
if [ ! -f "$DB" ]; then
  echo "No stats database at $DB (has the demo served anyone yet?)" >&2
  exit 1
fi

sqlite3 -readonly "$DB" <<'SQL'
.headers on
.mode column

SELECT count(*) AS active_now FROM sandbox_sessions WHERE ended_at IS NULL;

.print
.print ── Sessions by day (last 14 days) ──
-- "engaged" = changed something, not just looked around
SELECT substr(created_at, 1, 10) AS day,
       count(*) AS sessions,
       sum(writes > 0) AS engaged,
       round(avg((julianday(ended_at) - julianday(created_at)) * 24 * 60), 1) AS avg_min,
       max(requests) AS max_requests
  FROM sandbox_sessions
 WHERE created_at >= date('now', 'localtime', '-13 days')
 GROUP BY day
 ORDER BY day DESC;

.print
.print ── Referrers (last 14 days) ──
SELECT coalesce(referrer, '(direct)') AS referrer, count(*) AS sessions
  FROM sandbox_sessions
 WHERE created_at >= date('now', 'localtime', '-13 days')
 GROUP BY 1
 ORDER BY 2 DESC
 LIMIT 15;

.print
.print ── Modules touched (last 14 days, sessions per module) ──
WITH RECURSIVE split(module, rest) AS (
  SELECT '', modules || ','
    FROM sandbox_sessions
   WHERE modules != '' AND created_at >= date('now', 'localtime', '-13 days')
  UNION ALL
  SELECT substr(rest, 1, instr(rest, ',') - 1),
         substr(rest, instr(rest, ',') + 1)
    FROM split
   WHERE rest != ''
)
SELECT module, count(*) AS sessions
  FROM split
 WHERE module != ''
 GROUP BY module
 ORDER BY sessions DESC;

.print
.print ── How sessions end (last 14 days) ──
SELECT coalesce(end_reason, '(still running)') AS end_reason, count(*) AS sessions
  FROM sandbox_sessions
 WHERE created_at >= date('now', 'localtime', '-13 days')
 GROUP BY 1
 ORDER BY 2 DESC;
SQL
