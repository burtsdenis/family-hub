#!/usr/bin/env bash
#
# Выпуск локального сертификата и настройка имени хаба в сети.
# Запускать на маке-сервере. Нужен mkcert: brew install mkcert
#
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null; then
  echo "mkcert не установлен. Выполните: brew install mkcert" >&2
  exit 1
fi

# Желаемое имя: из .env, из аргумента или hub.local по умолчанию
HUB_HOST="${1:-$(grep -E '^HUB_HOST=' .env 2>/dev/null | cut -d= -f2 || true)}"
HUB_HOST="${HUB_HOST:-hub.local}"

LOCAL_NAME="$(scutil --get LocalHostName 2>/dev/null || echo "")"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"

echo "Имя хаба:        $HUB_HOST"
echo "Имя мака в сети: ${LOCAL_NAME:-не определено}.local"
echo "IP в сети:       ${LAN_IP:-не определён}"
echo

# ── Разрешимость имени ────────────────────────────────────────────────────
#
# Домен .local обслуживает Bonjour, и он отвечает только на собственное имя
# машины. Произвольное имя вроде hub.local не разрешится само ни на маке,
# ни на iPad. Правка /etc/hosts помогает только тому маку, где она сделана —
# для iPad и телефонов она бесполезна.
#
# Поэтому имя хаба должно совпадать с именем мака в сети.
#
SHORT_NAME="${HUB_HOST%.local}"

if [[ "$HUB_HOST" == *.local && "$SHORT_NAME" != "$LOCAL_NAME" ]]; then
  echo "⚠️  $HUB_HOST не будет разрешаться с других устройств."
  echo
  echo "    Bonjour отвечает только на собственное имя мака: ${LOCAL_NAME}.local"
  echo "    Есть два выхода."
  echo
  echo "    1. Переименовать мак — тогда $HUB_HOST заработает на всех устройствах"
  echo "       сразу, без настройки каждого:"
  echo
  echo "         sudo scutil --set LocalHostName $SHORT_NAME"
  echo
  echo "    2. Использовать имя, которое у мака уже есть. Впишите в .env:"
  echo
  echo "         HUB_HOST=${LOCAL_NAME}.local"
  echo
  read -r -p "    Переименовать мак в '$SHORT_NAME' сейчас? [y/N] " answer
  if [[ "${answer:-n}" =~ ^[Yy]$ ]]; then
    sudo scutil --set LocalHostName "$SHORT_NAME"
    LOCAL_NAME="$SHORT_NAME"
    echo "    Готово: мак теперь отзывается на $HUB_HOST"
  else
    echo "    Оставляю как есть. Сертификат всё равно выпущу — но помните про имя."
  fi
  echo
fi

# ── Сертификат ────────────────────────────────────────────────────────────
mkdir -p certs
mkcert -install

# Имена в сертификате: имя хаба, имя мака, localhost и IP.
# Лишние не мешают, а вот отсутствие нужного заставит браузер ругаться.
NAMES=("$HUB_HOST" "localhost" "127.0.0.1")
[[ -n "$LOCAL_NAME" && "$LOCAL_NAME.local" != "$HUB_HOST" ]] && NAMES+=("$LOCAL_NAME.local")
[[ -n "$LAN_IP" ]] && NAMES+=("$LAN_IP")

mkcert -cert-file certs/hub.pem -key-file certs/hub-key.pem "${NAMES[@]}"

# Имя для Caddy храним в .env, чтобы конфиг не пришлось править руками
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

Сертификат выпущен на: ${NAMES[*]}

Дальше:

  1. Поднять Caddy:
       docker compose --profile https up -d

  2. Включить защищённые куки — в .env:
       SECURE_COOKIES=true
     и перезапустить: docker compose up -d

  3. По одному разу на каждое устройство — доверие корневому сертификату:
       $(mkcert -CAROOT)/rootCA.pem
     Перекинуть на iPad и айфоны через AirDrop, затем
       Настройки → Профиль загружен → Установить
       Настройки → Основные → Об этом устройстве → Доверие сертификатам →
       включить полное доверие для mkcert

После этого https://$HUB_HOST открывается без предупреждений — порт указывать
не нужно, 443 подразумевается. Заработают офлайн-режим и иконка на домашнем
экране: и то и другое требует защищённого соединения.
TXT
