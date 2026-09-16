#!/usr/bin/env bash
# Atualiza a instalação a partir do GitHub: código, dependências, build do
# cliente e reinício do serviço. Executar como root na VPS.
set -euo pipefail

RAIZ=/opt/notafacil
export PATH="$RAIZ/node/bin:$PATH"

sudo -u notafacil git -C "$RAIZ/app" pull --ff-only
sudo -u notafacil env PATH="$PATH" npm --prefix "$RAIZ/app/server" ci --omit=dev
sudo -u notafacil env PATH="$PATH" npm --prefix "$RAIZ/app/web" ci
sudo -u notafacil env PATH="$PATH" npm --prefix "$RAIZ/app/web" run build
systemctl restart notafacil
sleep 2
curl -fsS "http://127.0.0.1:$(grep -E '^PORT=' "$RAIZ/app/server/.env" | cut -d= -f2)/api/saude"
echo
