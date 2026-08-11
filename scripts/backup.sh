#!/usr/bin/env bash
# Ночной бэкап: снимок базы, экспорт заметок в markdown, шифрование, пуш в git.
# Ставится в cron на 03:00. Вложения сюда не входят — они идут в Time Machine.
set -euo pipefail

DATA_DIR="${DATA_DIR:-$HOME/.family-hub}"
BACKUP_DIR="$DATA_DIR/backups"
REPO_DIR="${BACKUP_REPO_DIR:-$HOME/family-hub-backup}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
STAMP=$(date +%Y-%m-%d)

mkdir -p "$BACKUP_DIR"

# 1. Консистентный снимок базы (безопасно при работающем приложении)
sqlite3 "$DATA_DIR/hub.db" ".backup '$BACKUP_DIR/hub-$STAMP.db'"

# 2. Экспорт заметок в markdown — страховка на случай смерти приложения
NOTES_DIR="$BACKUP_DIR/notes-$STAMP"
mkdir -p "$NOTES_DIR"
# Перевод строки в заголовке ломал бы построчное чтение — заменяем пробелом
sqlite3 "$BACKUP_DIR/hub-$STAMP.db" \
  "SELECT id || '|' || replace(replace(replace(title, '|', '-'), char(10), ' '), char(13), ' ') FROM notes;" |
while IFS='|' read -r note_id note_title; do
  [ -z "$note_id" ] && continue
  safe_title=$(echo "$note_title" | tr '/' '-')
  target="$NOTES_DIR/$safe_title.md"
  # Заголовки могут совпадать: без суффикса вторая заметка молча
  # перетирала бы первую, и из экспорта пропадало бы содержимое
  if [ -e "$target" ]; then
    target="$NOTES_DIR/$safe_title-${note_id:0:8}.md"
  fi
  sqlite3 "$BACKUP_DIR/hub-$STAMP.db" \
    "SELECT body_md FROM notes WHERE id = '$note_id';" > "$target"
done

# 3. Архив и шифрование
tar -czf "$BACKUP_DIR/hub-$STAMP.tar.gz" -C "$BACKUP_DIR" "hub-$STAMP.db" "notes-$STAMP"

if [ -n "$AGE_RECIPIENT" ]; then
  age -r "$AGE_RECIPIENT" -o "$BACKUP_DIR/hub-$STAMP.tar.gz.age" "$BACKUP_DIR/hub-$STAMP.tar.gz"
  ARTIFACT="$BACKUP_DIR/hub-$STAMP.tar.gz.age"
  rm -f "$BACKUP_DIR/hub-$STAMP.tar.gz"
else
  echo "AGE_RECIPIENT не задан — бэкап не зашифрован. В приватный репозиторий не отправляю." >&2
  exit 1
fi

# 4. Пуш в приватный репозиторий
if [ -d "$REPO_DIR/.git" ]; then
  cp "$ARTIFACT" "$REPO_DIR/"
  cd "$REPO_DIR"
  git add -A
  git commit -m "Бэкап $STAMP" --quiet || true
  git push --quiet
fi

# 5. Локально держим две недели
find "$BACKUP_DIR" -name 'hub-*.db' -mtime +14 -delete
find "$BACKUP_DIR" -name 'notes-*' -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true

echo "Бэкап $STAMP готов."
