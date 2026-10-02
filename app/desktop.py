# Copyright (c) 2026 Filipe Vasconcelos Batista <filipevbatista1@gmail.com>
# Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
"""Light Downloader: janela de ambiente de trabalho (GTK 4 + libadwaita + WebKit).

Arranca o servidor Flask (main.py) por dentro, numa porta local aleatória, e mostra a mesma interface web
numa janela própria. A janela acrescenta o que um browser não pode fazer: o diálogo nativo para escolher
a pasta de destino e abrir os links externos no browser do sistema.

    python3 desktop.py           abre a janela
    python3 desktop.py --check   arranca só o servidor, verifica a API e sai (sem janela; para testes)
"""
import json
import os
import secrets
import sys
import threading
import urllib.request

import gi

gi.require_version("GLib", "2.0")
from gi.repository import GLib  # noqa: E402

APP_ID = "io.github.Filipe_Vasconcelos_Batista.LightDownloader"
HERE = os.path.dirname(os.path.abspath(__file__))


def setup_environment():
    """Pastas XDG (no Flatpak ficam em ~/.var/app/<id>/) e segredo deste arranque. Tem de correr antes de importar main."""
    config = os.path.join(GLib.get_user_config_dir(), "light-downloader")  # settings.yaml (chaves e limites)
    data = os.path.join(GLib.get_user_data_dir(), "light-downloader")  # histórico, consumo, destino escolhido
    videos = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS) or os.path.expanduser("~/Videos")
    downloads = os.path.join(videos, "Light Downloader")  # destino por defeito
    for path in (config, data, downloads):
        os.makedirs(path, exist_ok=True)
    os.environ.setdefault("LD_NATIVE", "1")
    os.environ.setdefault("LD_CONFIG_DIR", data)
    os.environ.setdefault("LD_SETTINGS_FILE", os.path.join(config, "settings.yaml"))
    os.environ.setdefault("LD_DOWNLOADS", downloads)
    os.environ["LD_TOKEN"] = secrets.token_urlsafe(24)  # só quem o tiver fala com o servidor local
    return os.environ["LD_TOKEN"]


def start_server():
    """Servidor local em 127.0.0.1, porta livre à escolha do sistema. Devolve (módulo main, url base)."""
    sys.path.insert(0, HERE)
    import main
    from werkzeug.serving import make_server

    server = make_server("127.0.0.1", 0, main.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return main, f"http://127.0.0.1:{server.server_port}"


def check(base, token):
    """Teste sem janela: o servidor responde com o segredo e recusa sem ele."""
    def get(path, cookie=None):
        req = urllib.request.Request(base + path, headers={"Cookie": f"ld={cookie}"} if cookie else {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b""

    status_open, body = get("/api/config", cookie=token)
    status_closed, _ = get("/api/config")
    status_page, _ = get(f"/?token={token}")
    cfg = json.loads(body) if status_open == 200 else {}
    print(json.dumps({"api_with_token": status_open, "api_without_token": status_closed, "page": status_page,
                      "native": cfg.get("native"), "dest": cfg.get("dest_label"),
                      "settings_dir": os.path.dirname(os.environ["LD_SETTINGS_FILE"])}, indent=2))
    return status_open == 200 and status_closed == 403 and status_page == 200 and cfg.get("native") is True


# ---------------------------------------------------------------- janela

PT = GLib.get_language_names()[0].startswith("pt")
TEXT = {
    "choose": ("Escolher a pasta de destino", "Choose the destination folder"),
    "cannot": ("Não consigo usar esta pasta", "Cannot use this folder"),
    "busy": ("Há downloads em curso", "Downloads are in progress"),
    "busy_body": ("Se fechares agora, os downloads são interrompidos. Os ficheiros a meio ficam guardados e podes retomá-los depois.",
                  "If you close now, the downloads are interrupted. Partial files are kept so you can resume them later."),
    "cancel": ("Cancelar", "Cancel"),
    "close": ("Fechar mesmo assim", "Close anyway"),
    "ok": ("OK", "OK"),
}


def tr(key):
    return TEXT[key][0 if PT else 1]


def run_window(main, base, token):
    gi.require_version("Gtk", "4.0")
    gi.require_version("Adw", "1")
    gi.require_version("WebKit", "6.0")
    from gi.repository import Adw, Gio, Gtk, WebKit

    class Window(Adw.ApplicationWindow):
        def __init__(self, app):
            super().__init__(application=app, title="Light Downloader", default_width=1100, default_height=820)
            self.closing_confirmed = False

            # Canal JS -> Python: a página pede o diálogo nativo de pastas com
            # window.webkit.messageHandlers.chooseFolder.postMessage('')
            content = WebKit.UserContentManager()
            content.register_script_message_handler("chooseFolder", None)
            content.connect("script-message-received::chooseFolder", self.on_choose_folder)

            self.web = WebKit.WebView(user_content_manager=content)
            self.web.get_settings().set_property("enable-developer-extras", False)
            self.web.connect("decide-policy", self.on_policy)
            self.web.connect("create", self.on_new_window)
            self.web.load_uri(f"{base}/?token={token}" + (f"#{os.environ['LD_START_HASH']}" if os.environ.get("LD_START_HASH") else ""))

            view = Adw.ToolbarView()
            view.add_top_bar(Adw.HeaderBar())
            view.set_content(self.web)
            self.set_content(view)
            self.connect("close-request", self.on_close)

        # --- diálogo nativo de pastas, a abrir na pasta pessoal
        def on_choose_folder(self, _content, _value):
            dialog = Gtk.FileDialog(title=tr("choose"), modal=True)
            dialog.set_initial_folder(Gio.File.new_for_path(os.path.expanduser("~")))
            dialog.select_folder(self, None, self.on_folder_chosen)

        def on_folder_chosen(self, dialog, result):
            try:
                folder = dialog.select_folder_finish(result)
            except GLib.Error:
                return  # cancelado
            try:
                main.set_dest_abs(folder.get_path())
            except ValueError as e:
                alert = Adw.AlertDialog.new(tr("cannot"), str(e))
                alert.add_response("ok", tr("ok"))
                alert.present(self)
                return
            self.web.evaluate_javascript("window.dispatchEvent(new Event('ld-dest-changed'))", -1, None, None, None, None)

        # --- links externos abrem no browser do sistema, não dentro da janela
        def open_external(self, uri):
            Gio.AppInfo.launch_default_for_uri(uri, None)

        def on_policy(self, _web, decision, decision_type):
            if decision_type in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
                uri = decision.get_navigation_action().get_request().get_uri()
                if not uri.startswith(base):
                    self.open_external(uri)
                    decision.ignore()
                    return True
            return False

        def on_new_window(self, _web, action):
            self.open_external(action.get_request().get_uri())  # target="_blank"
            return None

        # --- fechar com downloads a decorrer pede confirmação
        def on_close(self, _window):
            running = [j for j in list(main.jobs.values()) if j["status"] in main.RUNNING]
            if not running or self.closing_confirmed:
                return False
            alert = Adw.AlertDialog.new(tr("busy"), tr("busy_body"))
            alert.add_response("cancel", tr("cancel"))
            alert.add_response("close", tr("close"))
            alert.set_response_appearance("close", Adw.ResponseAppearance.DESTRUCTIVE)
            alert.set_default_response("cancel")
            alert.choose(self, None, self.on_close_answer)
            return True  # adia o fecho até haver resposta

        def on_close_answer(self, alert, result):
            if alert.choose_finish(result) == "close":
                self.closing_confirmed = True
                self.close()

    class Application(Adw.Application):
        def __init__(self):
            super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.DEFAULT_FLAGS)

        def do_activate(self):
            (self.props.active_window or Window(self)).present()

    return Application().run([])


def main_entry():
    token = setup_environment()
    main, base = start_server()
    if "--check" in sys.argv:
        sys.exit(0 if check(base, token) else 1)
    sys.exit(run_window(main, base, token))


if __name__ == "__main__":
    main_entry()
