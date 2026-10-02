#!/usr/bin/env bash
# Cria o instalador de um só ficheiro (flatpak/out/Instalar-Light-Downloader.sh) a partir da app já construída.
# Corre depois do flatpak-builder (o flatpak/build.sh já o chama).
set -euo pipefail
cd "$(dirname "$0")/.."
ID=io.github.Filipe_Vasconcelos_Batista.LightDownloader
OUT=flatpak/out/Instalar-Light-Downloader.sh

mkdir -p flatpak/out
flatpak build-bundle ~/.local/share/flatpak/repo flatpak/out/light-downloader.flatpak "$ID" master
cat flatpak/installer-header.sh flatpak/out/light-downloader.flatpak > "$OUT"
chmod +x "$OUT"
# ícone do ficheiro no gestor de ficheiros (Nemo/Nautilus), se suportado
gio set -t string "$OUT" metadata::custom-icon "file://$PWD/flatpak/icons/$ID-256.png" 2>/dev/null || true
echo "Instalador pronto: $OUT ($(du -h "$OUT" | cut -f1))"
