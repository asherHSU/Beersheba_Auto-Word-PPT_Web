#!/bin/sh
# 僅啟動 Cloudflare Tunnel，不依賴 docker compose 專案名稱（避免與 Container Manager 建立的 stack 衝突）。
# 前提：church_frontend 已由 compose 啟動；.env 含 CLOUDFLARE_TUNNEL_TOKEN。
# 用法（在專案根目錄）：sh scripts/start-cloudflared-tunnel.sh
# Cloudflare Public Hostname 服務 URL：http://localhost:80

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

if [ ! -f .env ]; then
  echo "找不到 $ROOT/.env"
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -z "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  echo "請在 .env 設定 CLOUDFLARE_TUNNEL_TOKEN"
  exit 1
fi

if ! docker inspect church_frontend >/dev/null 2>&1; then
  echo "找不到容器 church_frontend，請先啟動主服務（mongo / backend / frontend）"
  exit 1
fi

docker rm -f church_cloudflared 2>/dev/null || true

exec docker run -d \
  --name church_cloudflared \
  --restart unless-stopped \
  --network container:church_frontend \
  cloudflare/cloudflared:latest \
  tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN"
