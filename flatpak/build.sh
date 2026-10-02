#!/usr/bin/env bash
# Constrói o frontend e o Flatpak, e instala-o na tua conta (sem sudo).
#   flatpak/build.sh          constrói e instala
#   flatpak run io.github.Filipe_Vasconcelos_Batista.LightDownloader
set -euo pipefail
cd "$(dirname "$0")/.."
ID=io.github.Filipe_Vasconcelos_Batista.LightDownloader

echo "==> Frontend"
(cd frontend && npm install --no-audit --no-fund && npm run build)

echo "==> A preparar flatpak/stage (o flatpak-builder não tem rede, por isso o frontend já vai compilado)"
rm -rf flatpak/stage && mkdir -p flatpak/stage
cp app/main.py app/desktop.py flatpak/stage/
cp -r frontend/dist flatpak/stage/static

echo "==> flatpak-builder (gera o repositório em flatpak/out/repo, com o catálogo AppStream)"
flatpak-builder --force-clean --state-dir=.flatpak-builder --repo=flatpak/out/repo build-flatpak "flatpak/$ID.yml"

if [ "${1:-}" = "--install" ]; then   # só para desenvolvimento: instala já na tua conta
  flatpak install --user -y --noninteractive --reinstall flatpak/out/repo "$ID" 2>/dev/null \
    || flatpak-builder --user --install --force-clean --state-dir=.flatpak-builder build-flatpak "flatpak/$ID.yml"
fi

echo "Repositório pronto: flatpak/out/repo"
