#!/bin/bash
# Light Downloader: instalador de um só ficheiro (a aplicação vai incluída no fim deste ficheiro).
# Duplo clique -> "Executar". Também: ./Instalar-Light-Downloader.sh [--no-gui] [--uninstall]
APP_ID="io.github.Filipe_Vasconcelos_Batista.LightDownloader"

# Idioma: o da sessão (português se começar por pt, senão inglês). O botão do primeiro ecrã troca.
SYS_LANG=""
for v in "$LC_ALL" "$LANGUAGE" "$LC_MESSAGES" "$LANG"; do
  [ -n "${v%%:*}" ] && { SYS_LANG="${v%%:*}"; break; }
done
case "$SYS_LANG" in pt*) PT=1 ;; *) PT=0 ;; esac
t() { if [ "$PT" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

GUI=1
[ "$1" = "--no-gui" ] && GUI=0
[ -z "$DISPLAY$WAYLAND_DISPLAY" ] && GUI=0
command -v zenity >/dev/null 2>&1 || GUI=0

plain() { printf '%b' "$1" | sed 's/<[^>]*>//g'; echo; }
info() { if [ $GUI = 1 ]; then zenity --info --no-wrap --title "Light Downloader" --text "$1"; else plain "$1"; fi; }
fail() { if [ $GUI = 1 ]; then zenity --error --no-wrap --title "Light Downloader" --text "$1"; else plain "ERRO: $1" >&2; fi; exit 1; }

command -v flatpak >/dev/null 2>&1 || fail "$(t 'Falta o Flatpak.\n\nsudo apt install flatpak' 'Flatpak is missing.\n\nsudo apt install flatpak')"

# ---- remover (de qualquer sítio onde esteja; as definições e o histórico ficam)
do_uninstall() {
  local log failed=0; log=$(mktemp)
  flatpak info --user "$APP_ID" >/dev/null 2>&1 && { flatpak uninstall --user -y "$APP_ID" >>"$log" 2>&1 || failed=1; }
  flatpak info --system "$APP_ID" >/dev/null 2>&1 && { flatpak uninstall --system -y "$APP_ID" >>"$log" 2>&1 || failed=1; }
  if [ $failed = 1 ]; then
    fail "$(t 'Não consegui remover.' 'Could not remove it.')\n\n$(tail -n 6 "$log" | sed 's/&/e/g; s/</(/g; s/>/)/g')"
  fi
  rm -f "$log"
  info "$(t 'Light Downloader removido.' 'Light Downloader removed.')"
  exit 0
}
[ "$1" = "--uninstall" ] && do_uninstall

# ---- pergunta (com botão para trocar de idioma)
if [ $GUI = 1 ]; then
  while true; do
    OTHER="$(t 'English' 'Português')"
    if flatpak info "$APP_ID" >/dev/null 2>&1; then   # já instalado: atualizar ou desinstalar
      REMOVE="$(t 'Desinstalar' 'Uninstall')"
      ANSWER=$(zenity --question --no-wrap --title "Light Downloader" --extra-button "$REMOVE" --extra-button "$OTHER" \
        --ok-label "$(t 'Atualizar' 'Update')" --cancel-label "$(t 'Cancelar' 'Cancel')" \
        --text "$(t '<b>Light Downloader</b> já está instalado.' '<b>Light Downloader</b> is already installed.')")
    else
      REMOVE=""
      ANSWER=$(zenity --question --no-wrap --title "Light Downloader" --extra-button "$OTHER" \
        --ok-label "$(t 'Instalar' 'Install')" --cancel-label "$(t 'Cancelar' 'Cancel')" \
        --text "$(t 'Instalar o <b>Light Downloader</b>?' 'Install <b>Light Downloader</b>?')")
    fi
    RC=$?
    if [ "$ANSWER" = "$OTHER" ]; then PT=$((1 - PT)); continue; fi
    if [ -n "$REMOVE" ] && [ "$ANSWER" = "$REMOVE" ]; then do_uninstall; fi
    [ $RC = 0 ] && break || exit 0
  done
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# a aplicação (um ficheiro .flatpak) vem colada a seguir à linha de marca no fim deste ficheiro
OFFSET=$(grep -abo '^__PAYLOAD__$' "$0" | head -1 | cut -d: -f1)
tail -c +$((OFFSET + 13)) "$0" > "$TMP/app.flatpak" || fail "$(t 'Não consegui abrir o pacote incluído.' 'Could not read the bundled package.')"

# ---- instalação: para todo o sistema (aparece logo no menu, pede a password de administrador, como o Software Manager);
#      se for cancelada ou falhar, só para este utilizador (não pede nada, mas o menu pode precisar de ser reiniciado)
run_install() {
  : > "$TMP/log"
  # uma instalação anterior sai primeiro (as definições e o histórico ficam em ~/.var)
  flatpak info --user "$APP_ID" >/dev/null 2>&1 && flatpak uninstall --user -y "$APP_ID" >>"$TMP/log" 2>&1
  if flatpak info --system "$APP_ID" >/dev/null 2>&1; then
    flatpak uninstall --system -y "$APP_ID" >>"$TMP/log" 2>&1 || { echo 1 > "$TMP/rc"; return; }
  fi

  if flatpak remotes --system --columns=name 2>/dev/null | grep -qx flathub \
     && flatpak install --system -y --noninteractive "$TMP/app.flatpak" >>"$TMP/log" 2>&1; then
    echo system > "$TMP/scope"; echo 0 > "$TMP/rc"; return
  fi

  flatpak remotes --columns=name 2>/dev/null | grep -qx flathub \
    || flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo >>"$TMP/log" 2>&1
  flatpak install --user -y --noninteractive "$TMP/app.flatpak" >>"$TMP/log" 2>&1
  echo $? > "$TMP/rc"; echo user > "$TMP/scope"
}

if [ $GUI = 1 ]; then
  run_install | zenity --progress --pulsate --no-cancel --auto-close --title "Light Downloader" --text "$(t 'A instalar...' 'Installing...')"
else
  plain "$(t 'A instalar...' 'Installing...')"; run_install
fi

if [ "$(cat "$TMP/rc" 2>/dev/null)" != "0" ]; then
  fail "$(t 'A instalação falhou.' 'The installation failed.')\n\n$(tail -n 8 "$TMP/log" | sed 's/&/e/g; s/</(/g; s/>/)/g')"
fi

DONE="$(t '<b>Light Downloader</b> instalado.' '<b>Light Downloader</b> installed.')"
# só para o utilizador: o menu pode não reparar no atalho novo até ser reiniciado
if [ "$(cat "$TMP/scope")" = "user" ]; then
  DONE="$DONE\n\n$(t 'Se não aparecer no menu: Alt+F2, escreve r, Enter.' 'If it is not in the menu: Alt+F2, type r, Enter.')"
fi
if [ $GUI = 1 ]; then
  zenity --question --no-wrap --title "Light Downloader" --ok-label "$(t 'Abrir' 'Open')" --cancel-label "$(t 'Fechar' 'Close')" --text "$DONE" \
    && { nohup flatpak run "$APP_ID" >/dev/null 2>&1 & }
else
  plain "$DONE"
fi
exit 0
__PAYLOAD__
