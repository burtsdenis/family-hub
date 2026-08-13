#!/usr/bin/env bash
# Nightly backup: database snapshot, notes export to markdown, encryption, git push.
# Goes into cron at 03:00. Attachments are not included — Time Machine covers them.
set -euo pipefail

DATA_DIR="${DATA_DIR:-$HOME/.family-hub}"
BACKUP_DIR="$DATA_DIR/backups"
REPO_DIR="${BACKUP_REPO_DIR:-$HOME/family-hub-backup}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
STAMP=$(date +%Y-%m-%d)

# Dead-man switch (optional): ping a healthchecks.io-style URL on every
# outcome, so a backup that silently stops running raises an alarm — the
# one failure mode a nightly cron hides best. The app container ships no
# curl; node is always there.
PING_URL="${BACKUP_PING_URL:-}"
report() {
  [ -z "$PING_URL" ] && return 0
  node -e "fetch(process.argv[1], { signal: AbortSignal.timeout(10000) }).catch(() => {})" \
    "$PING_URL$1" 2>/dev/null || true
}
trap 'status=$?; if [ "$status" -eq 0 ]; then report ""; else report "/fail"; fi' EXIT

mkdir -p "$BACKUP_DIR"

# 1. Consistent database snapshot (safe while the app is running)
sqlite3 "$DATA_DIR/hub.db" ".backup '$BACKUP_DIR/hub-$STAMP.db'"

# 2. Notes export to markdown — insurance in case the app dies
NOTES_DIR="$BACKUP_DIR/notes-$STAMP"
mkdir -p "$NOTES_DIR"
# A newline in a title would break line-by-line reading — replace with a space
sqlite3 "$BACKUP_DIR/hub-$STAMP.db" \
  "SELECT id || '|' || replace(replace(replace(title, '|', '-'), char(10), ' '), char(13), ' ') FROM notes;" |
while IFS='|' read -r note_id note_title; do
  [ -z "$note_id" ] && continue
  safe_title=$(echo "$note_title" | tr '/' '-')
  target="$NOTES_DIR/$safe_title.md"
  # Titles may collide: without a suffix the second note would silently
  # overwrite the first, and content would vanish from the export
  if [ -e "$target" ]; then
    target="$NOTES_DIR/$safe_title-${note_id:0:8}.md"
  fi
  sqlite3 "$BACKUP_DIR/hub-$STAMP.db" \
    "SELECT body_md FROM notes WHERE id = '$note_id';" > "$target"
done

# 3. Archive and encrypt
tar -czf "$BACKUP_DIR/hub-$STAMP.tar.gz" -C "$BACKUP_DIR" "hub-$STAMP.db" "notes-$STAMP"

if [ -n "$AGE_RECIPIENT" ]; then
  age -r "$AGE_RECIPIENT" -o "$BACKUP_DIR/hub-$STAMP.tar.gz.age" "$BACKUP_DIR/hub-$STAMP.tar.gz"
  ARTIFACT="$BACKUP_DIR/hub-$STAMP.tar.gz.age"
  rm -f "$BACKUP_DIR/hub-$STAMP.tar.gz"
else
  echo "AGE_RECIPIENT is not set — the backup is unencrypted. Not pushing to the private repository." >&2
  exit 1
fi

# 4. Push to the private repository
if [ -d "$REPO_DIR/.git" ]; then
  cp "$ARTIFACT" "$REPO_DIR/"
  cd "$REPO_DIR"
  git add -A
  git commit -m "Backup $STAMP" --quiet || true
  git push --quiet
fi

# 5. Keep two weeks locally
find "$BACKUP_DIR" -name 'hub-*.db' -mtime +14 -delete
find "$BACKUP_DIR" -name 'notes-*' -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true

echo "Backup $STAMP is ready."
