# Copyright (c) 2026 Filipe Vasconcelos Batista <filipevbatista1@gmail.com>
# Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import datetime
import json
import os
import re
import threading
import time
import uuid
from zoneinfo import ZoneInfo

import requests
from flask import Flask, jsonify, request, send_from_directory

# Caminhos: no Docker são os do container; fora dele (Flatpak, nativo) definem-se por variáveis de ambiente
DOWNLOADS = os.environ.get("LD_DOWNLOADS", "/downloads")  # destino por defeito
SELECTABLE = os.environ.get("LD_SELECTABLE", "/selectable")  # raiz opcional navegável na app
CONFIG_DIR = os.environ.get("LD_CONFIG_DIR", "/config")  # definições e histórico
CONFIG = os.path.join(CONFIG_DIR, "config.json")
HISTORY = os.path.join(CONFIG_DIR, "history.json")
USAGE = os.path.join(CONFIG_DIR, "usage.json")
PERIODS = ("day", "week", "month", "year")
GIB = 1024 ** 3
FR = ZoneInfo("Europe/Paris")  # a API do 1fichier indica que as datas são na hora de França
API = "https://api.1fichier.com/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0"
ACTIVE = ("queued", "getting_link", "downloading", "paused")
RUNNING = ("queued", "getting_link", "downloading")

app = Flask(__name__, static_folder="static", static_url_path="")
jobs = {}  # id -> dict
lock = threading.Lock()


class Slots:
    """Limite de downloads em simultâneo que pode mudar em execução (ao contrário de um Semaphore)."""

    def __init__(self):
        self.cv = threading.Condition()
        self.n = 0

    def __enter__(self):
        with self.cv:
            self.cv.wait_for(lambda: self.n < get_max_parallel())
            self.n += 1

    def __exit__(self, *exc):
        with self.cv:
            self.n -= 1
            self.cv.notify_all()


sem = Slots()


class Throttle:
    """Limite de velocidade global. Cada bloco reserva o seu intervalo de tempo num relógio partilhado,
    por isso a soma de todos os downloads em simultâneo respeita o limite."""

    def __init__(self):
        self.lock = threading.Lock()
        self.next = time.monotonic()

    def wait(self, nbytes):
        limit = get_speed_limit()  # bytes/s; 0 = sem limite
        if not limit:
            return
        with self.lock:
            now = time.monotonic()
            self.next = min(max(self.next, now), now + 1)  # não acumula atrasos se o limite mudar
            delay = self.next - now
            self.next += nbytes / limit
        if delay > 0:
            time.sleep(delay)


throttle = Throttle()


def load_cfg():
    try:
        with open(CONFIG) as f:
            return json.load(f)
    except Exception:
        return {}


def save_cfg(c):
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    with open(CONFIG, "w") as f:
        json.dump(c, f)
    os.chmod(CONFIG, 0o600)


def selectable_enabled():
    return bool(os.environ.get("HOST_SELECTABLE_DIR", "").strip())


def resolve_dir(rel):
    """Caminho dentro de /selectable; recusa tudo o que saia dessa raiz."""
    root = os.path.realpath(SELECTABLE)
    p = os.path.realpath(os.path.join(root, (rel or "").strip("/")))
    if p != root and not p.startswith(root + os.sep):
        raise ValueError("Pasta fora da raiz permitida")
    return p


def rel_dir(p):
    r = os.path.relpath(p, os.path.realpath(SELECTABLE))
    return "" if r == "." else r


def current_dest():
    """(caminho no container, rótulo no host) do destino em vigor."""
    rel = load_cfg().get("dest")  # None = destino por defeito
    if rel is not None and selectable_enabled():
        host = os.environ["HOST_SELECTABLE_DIR"].rstrip("/")
        return resolve_dir(rel), host + ("/" + rel if rel else "")
    return DOWNLOADS, os.environ.get("HOST_DOWNLOAD_DIR", DOWNLOADS)


def require_selectable():
    if not selectable_enabled():
        raise ValueError("Seleção de pastas desativada (SELECTABLE_DIR não definida)")


def load_history():
    try:
        with open(HISTORY) as f:
            return json.load(f)
    except Exception:
        return {}


def save_history(h):
    os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
    with open(HISTORY, "w") as f:
        json.dump(h, f)


def quota_today():
    """O dia que conta para a quota: por defeito o de França (como o 1fichier); ou o do container (TZ)."""
    if load_cfg().get("quota_clock") == "local":
        return datetime.date.today()
    return datetime.datetime.now(FR).date()


def month_anchor():
    """Dia do mês em que o 'mês' começa (1-28), para acompanhar a data de renovação da conta."""
    try:
        return max(1, min(28, int(load_cfg().get("quota_day") or 1)))
    except ValueError:
        return 1


def period_start(period, today=None):
    d = today or quota_today()
    if period == "day":
        return d
    if period == "week":
        return d - datetime.timedelta(days=d.weekday())  # segunda-feira
    if period == "month":
        a = month_anchor()
        if d.day >= a:
            return d.replace(day=a)
        return (d.replace(day=1) - datetime.timedelta(days=1)).replace(day=a)
    return d.replace(month=1, day=1)


def next_period_start(period, start):
    if period == "day":
        return start + datetime.timedelta(days=1)
    if period == "week":
        return start + datetime.timedelta(days=7)
    if period == "month":
        return (start.replace(day=28) + datetime.timedelta(days=4)).replace(day=month_anchor())
    return start.replace(year=start.year + 1)


class Usage:
    """Bytes descarregados por esta app, guardados por dia. Assim o período (dia/semana/mês/ano)
    pode mudar a qualquer momento: soma-se apenas os dias que pertencem ao período em vigor."""

    def __init__(self):
        self.lock = threading.Lock()
        self.saved = time.monotonic()
        try:
            with open(USAGE) as f:
                self.days = json.load(f)
        except Exception:
            self.days = {}

    def add(self, nbytes):
        with self.lock:
            k = quota_today().isoformat()
            self.days[k] = self.days.get(k, 0) + nbytes
            if time.monotonic() - self.saved > 5:
                self._save()

    def used(self, period):
        start = period_start(period).isoformat()
        with self.lock:
            return sum(v for k, v in self.days.items() if k >= start)

    def _save(self):
        cutoff = (quota_today() - datetime.timedelta(days=400)).isoformat()
        self.days = {k: v for k, v in self.days.items() if k >= cutoff}
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(USAGE, "w") as f:
            json.dump(self.days, f)
        self.saved = time.monotonic()

    def flush(self):
        with self.lock:
            self._save()

    def reset(self):
        with self.lock:
            self.days = {}
            self._save()


usage = Usage()


def get_quota():
    """(limite em bytes, período). Limite 0 = sem limite."""
    c = load_cfg()
    period = c.get("quota_period") if c.get("quota_period") in PERIODS else "month"
    try:
        return int(float(c.get("quota_gb") or 0) * GIB), period
    except ValueError:
        return 0, period


def quota_exceeded():
    limit, period = get_quota()
    return limit > 0 and usage.used(period) >= limit


def quota_info():
    limit, period = get_quota()
    start = period_start(period)
    return {"period": period, "limit": limit, "used": usage.used(period),
            "since": start.isoformat(), "resets": next_period_start(period, start).isoformat(),
            "exceeded": limit > 0 and usage.used(period) >= limit}


def quota_pause_all():
    """Limite atingido: pausa tudo o que está ativo ou na fila (retoma sozinho quando houver margem)."""
    with lock:
        for j in jobs.values():
            if j["status"] in RUNNING:
                j["status"], j["paused_by"], j["speed"] = "paused", "quota", 0
                j["gen"] += 1


def quota_tick():
    """Guarda o contador e retoma o que a quota tinha pausado, se já houver margem."""
    usage.flush()
    if not quota_exceeded():
        for j in list(jobs.values()):
            if j["status"] == "paused" and j.get("paused_by") == "quota":
                resume_job(j)


def quota_watcher():
    while True:
        time.sleep(20)
        quota_tick()


def record_history(job, dest):
    """Guarda um download concluído: url -> {filename, path (no container), rel (no destino), date}."""
    with lock:
        h = load_history()
        h[job["url"]] = {"filename": job["filename"], "path": dest, "rel": os.path.relpath(dest, job["dest"]),
                         "size": job["size"], "date": time.strftime("%Y-%m-%d %H:%M")}
        save_history(h)


def setting(name, env):
    """Valor guardado na app; se não houver, o do ambiente (.env) serve de valor inicial."""
    return (load_cfg().get(name) or "").strip() or os.environ.get(env, "").strip()


def setting_source(name, env):
    return "app" if (load_cfg().get(name) or "").strip() else "env" if os.environ.get(env, "").strip() else "none"


def get_key():
    return setting("api_key", "FICHIER_API_KEY")


def get_tmdb_key():
    return setting("tmdb_key", "TMDB_API_KEY")


def get_speed_limit():
    """Limite em bytes/s (definido em MB/s). 0 = sem limite."""
    try:
        mbps = float(load_cfg().get("speed_limit") or 0)
    except ValueError:
        return 0
    return int(max(0.0, min(mbps, 10000.0)) * 1_000_000)


def get_max_parallel():
    try:
        return max(1, min(10, int(load_cfg().get("max_parallel") or os.environ.get("MAX_PARALLEL") or 2)))
    except ValueError:
        return 2


def safe_name(n):
    n = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", n or "").strip(" .")
    return n or "ficheiro"


def list_folder(link):
    """Devolve [{filename,size,url}] de uma pasta partilhada do 1fichier."""
    m = re.search(r"1fichier\.com/(?:dir/|\?)([A-Za-z0-9]+)", link)
    if not m:
        raise ValueError("Link inválido")
    fid = m.group(1)
    r = requests.get(f"https://1fichier.com/dir/{fid}?json=2", headers={"User-Agent": UA}, timeout=30)
    try:
        data = r.json()
    except ValueError:
        data = None
    if isinstance(data, (list, dict)) and items_from_json(data):
        return items_from_json(data)
    # fallback: HTML da página da pasta
    html = requests.get(f"https://1fichier.com/dir/{fid}", headers={"User-Agent": UA}, timeout=30).text
    if "Accès restreint" in html or "professional infrastructure" in html:
        raise RuntimeError("O 1fichier bloqueou este IP (VPN/proxy/servidor?)")
    out = []
    for url, name in re.findall(r'<a href="(https://1fichier\.com/\?[A-Za-z0-9]+)"[^>]*>([^<]+)</a>', html):
        out.append({"filename": name.strip(), "size": 0, "url": url})
    if not out:
        raise RuntimeError("Não consegui listar ficheiros (pasta vazia, privada ou com password?)")
    return out


def items_from_json(data):
    """Normaliza as respostas do 1fichier (json=1 lista; json=2 dict indexado com a chave 'link')."""
    if isinstance(data, dict):
        vals = list(data.values())
        data = vals if vals and all(isinstance(v, dict) for v in vals) else \
            next((v for v in vals if isinstance(v, list)), [data])
    out = []
    for d in data:
        if isinstance(d, dict) and (d.get("url") or d.get("link")):
            out.append({"filename": d.get("filename") or "", "size": int(d.get("size") or 0),
                        "url": d.get("url") or d.get("link")})
    return out


def parse_tables(text):
    """Texto copiado da vista de tabela do browser ('0', 'link "..."', 'filename "..."', ...).
    Cada vez que o índice volta a 0 começa uma nova tabela."""
    tables, cur = [], None
    for line in text.splitlines():
        m = re.fullmatch(r"\s*(\d+)\s*", line)
        if m:
            if m.group(1) == "0" or not tables:
                tables.append([])
            cur = {}
            tables[-1].append(cur)
        elif cur is not None:
            m = re.match(r"\s*(\w+)\s+(.*?)\s*$", line)
            if m:
                cur[m.group(1)] = m.group(2).strip('"')
    return [items_from_json(t) for t in tables if items_from_json(t)]


def parse_json_docs(text):
    """Vários JSON seguidos -> lista de documentos; None se o texto não for só JSON (objetos/listas)."""
    dec, i, docs = json.JSONDecoder(), 0, []
    while True:
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            return docs or None
        try:
            doc, i = dec.raw_decode(text, i)
        except ValueError:
            return None
        if not isinstance(doc, (dict, list)):
            return None
        docs.append(doc)


def parse_groups(text, folders=False):
    """Divide o input em grupos [{kind, ref, files}]: um por JSON, tabela ou pasta (/dir/)."""
    docs = parse_json_docs(text)
    if docs:
        groups = [{"kind": "json", "ref": "", "files": items_from_json(d)} for d in docs]
        if not all(g["files"] for g in groups):
            raise ValueError("JSON sem entradas com 'url'/'link'")
        return groups
    tables = parse_tables(text)
    if tables:
        return [{"kind": "table", "ref": "", "files": t} for t in tables]
    links = list(dict.fromkeys(re.findall(r"https?://1fichier\.com/(?:dir/|\?)[A-Za-z0-9]+", text)))
    if not links:
        raise ValueError("Não encontrei links do 1fichier")
    groups = [{"kind": "folder", "ref": u, "files": list_folder(u)}
              for u in links if "/dir/" in u or folders]
    plain = [u for u in links if "/dir/" not in u and not folders]
    if plain:
        groups.append({"kind": "links", "ref": "", "files": [{"filename": "", "size": 0, "url": u} for u in plain]})
    return groups


SERIES_RE = re.compile(r"^(.*?)[\s._-]+S(\d{1,2})E(\d{1,3})", re.I)
ALT_RE = re.compile(r"^(.*?)[\s._-]+(\d{1,2})x(\d{2,3})\b", re.I)  # Nome 1x05
ABS_RE = re.compile(r"^(.*?)\s+-\s+(\d{1,3})(?:v\d+)?\s+-\s+")  # Nome - 05 - Título (numeração contínua)


def parse_episode(filename):
    """'Título.S02E05...' / 'Título 2x05' / 'Título - 05 - ...' -> ('Título', temporada, episódio).
    Sem temporada no nome assume-se a 1. Sem padrão -> ('', None, None)."""
    fn = filename or ""
    m = SERIES_RE.match(fn) or ALT_RE.match(fn)
    if m:
        season, ep = int(m.group(2)), int(m.group(3))
    else:
        m = ABS_RE.match(fn)
        if not m:
            return "", None, None
        season, ep = 1, int(m.group(2))
    title = re.sub(r"^(\[[^\]]*\]\s*)+", "", m.group(1))  # tira [grupo] no início
    return safe_name(re.sub(r"[._]+", " ", title).strip()), season, ep


def describe_group(group):
    """Acrescenta série/temporada/episódio a cada ficheiro e os nomes detectados (mais frequente primeiro)."""
    counts, first = {}, {}
    for f in group["files"]:
        f["series"], f["season"], f["episode"] = parse_episode(f["filename"])
        if f["series"]:
            k = f["series"].lower()
            counts[k] = counts.get(k, 0) + 1
            first.setdefault(k, f["series"])
    group["names"] = [first[k] for k in sorted(counts, key=counts.get, reverse=True)]
    return group


def series_name(filename, series="", year=""):
    """'Nome (Ano)'. 'series' força o nome; sem ele usa o detectado no ficheiro."""
    name = safe_name(series) if series else parse_episode(filename)[0]
    if name and year and not re.search(r"\(\d{4}\)$", name):
        name += f" ({year})"
    return name


def target_folder(filename, series="", year="", tmdb_id=""):
    """'Nome (Ano) [tmdbid-N]/Season NN'."""
    name = series_name(filename, series, year)
    if not name:
        return ""
    if tmdb_id:
        name += f" [tmdbid-{tmdb_id}]"
    season = parse_episode(filename)[1]
    return os.path.join(name, f"Season {season:02d}") if season is not None else name


NAME_MODES = ("original", "series", "episode")


def target_filename(filename, series="", year="", mode="original"):
    """original | series ('Nome (Ano) S01E01.ext') | episode ('S01E01.ext')."""
    _, season, ep = parse_episode(filename)
    if mode == "original" or season is None:
        return safe_name(filename)
    code = f"S{season:02d}E{ep:02d}"
    ext = os.path.splitext(filename)[1]
    if mode == "episode":
        return code + ext
    return f"{series_name(filename, series, year)} {code}{ext}"


def tmdb_get(path, **params):
    key = get_tmdb_key()
    if not key:
        raise RuntimeError("Chave do TMDB não definida (Definições)")
    headers = {"Authorization": f"Bearer {key}"} if key.startswith("eyJ") else {}
    if not headers:
        params["api_key"] = key
    r = requests.get(f"https://api.themoviedb.org/3{path}", params=params, headers=headers, timeout=15)
    if r.status_code == 401:
        raise RuntimeError("TMDB: chave inválida")
    r.raise_for_status()
    return r.json()


def advance(job, gen, status):
    """Muda o estado só se esta execução (gen) continua a ser a atual e o job não foi cancelado."""
    with lock:
        if job["gen"] != gen or job["status"] == "canceled":
            return False
        job["status"] = status
        return True


def run_job(job, gen):
    with sem:
        if quota_exceeded():
            quota_pause_all()
            return
        if not advance(job, gen, "getting_link"):
            return
        try:
            key = get_key()
            if not key:
                raise RuntimeError("API key não definida")
            auth = {"Authorization": f"Bearer {key}"}
            if not job["filename"]:
                info = requests.post(f"{API}/file/info.cgi", json={"url": job["url"]}, headers=auth, timeout=30).json()
                if info.get("status") == "KO" or not info.get("filename"):
                    raise RuntimeError(info.get("message", "Ficheiro não encontrado"))
                job["filename"] = info["filename"]
                job["size"] = int(info.get("size") or 0)
            r = requests.post(f"{API}/download/get_token.cgi", json={"url": job["url"]},
                              headers=auth, timeout=30)
            j = r.json()
            if j.get("status") != "OK":
                raise RuntimeError(j.get("message", "Erro ao obter link"))
            if not advance(job, gen, "downloading"):
                return
            dest = os.path.join(job["dest"], target_folder(job["filename"], job["series"], job["year"], job["tmdb_id"]),
                                target_filename(job["filename"], job["series"], job["year"], job["name_mode"]))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            part = dest + ".part"
            done = os.path.getsize(part) if os.path.exists(part) else 0
            hdr = {"User-Agent": UA}
            if done:
                hdr["Range"] = f"bytes={done}-"
            with requests.get(j["url"], headers=hdr, stream=True, timeout=60) as d:
                if d.status_code == 200:
                    done = 0
                elif d.status_code != 206:
                    raise RuntimeError(f"HTTP {d.status_code}")
                total = done + int(d.headers.get("Content-Length", 0))
                job["size"] = total or job["size"]
                t0, base = time.time(), done
                with open(part, "ab" if done else "wb") as f:
                    for chunk in d.iter_content(1 << 18):
                        throttle.wait(len(chunk))
                        if job["gen"] != gen or job["status"] == "canceled":
                            return  # pausado ou cancelado: o .part fica para retomar
                        f.write(chunk)
                        done += len(chunk)
                        job["done"] = done
                        job["speed"] = (done - base) / max(time.time() - t0, 0.001)
                        usage.add(len(chunk))
                        if quota_exceeded():
                            quota_pause_all()
                            return
            os.replace(part, dest)
            record_history(job, dest)
            job["status"] = "done"
        except Exception as e:
            job["status"] = "error"
            job["error"] = str(e)


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/config")
def get_config():
    return jsonify(has_key=bool(get_key()), has_tmdb=bool(get_tmdb_key()),
                   dest_label=current_dest()[1], selectable=selectable_enabled(),
                   selectable_root=os.environ.get("HOST_SELECTABLE_DIR", "").rstrip("/"),
                   dest_rel=load_cfg().get("dest") if selectable_enabled() else None)


@app.get("/api/usage")
def api_usage():
    return jsonify(quota_info())


@app.post("/api/usage/reset")
def api_usage_reset():
    usage.reset()
    return jsonify(ok=True)


@app.get("/api/settings")
def get_settings():
    """Nunca devolve as chaves, só se existem e de onde vêm (app ou .env)."""
    return jsonify(fichier={"set": bool(get_key()), "source": setting_source("api_key", "FICHIER_API_KEY")},
                   tmdb={"set": bool(get_tmdb_key()), "source": setting_source("tmdb_key", "TMDB_API_KEY")},
                   max_parallel=get_max_parallel(), speed_limit=get_speed_limit() / 1_000_000,
                   quota_gb=get_quota()[0] / GIB, quota_period=get_quota()[1], usage=quota_info(),
                   quota_clock=load_cfg().get("quota_clock", "fichier"), quota_day=month_anchor())


@app.post("/api/settings")
def set_settings():
    """Só altera o que vier no pedido. Texto vazio numa chave apaga o valor da app (volta a valer o .env)."""
    body, c = request.json, load_cfg()
    for field, name in (("fichier_api_key", "api_key"), ("tmdb_api_key", "tmdb_key")):
        if field in body:
            value = (body[field] or "").strip()
            if value:
                c[name] = value
            else:
                c.pop(name, None)
    if "speed_limit" in body:
        try:
            mbps = float(body["speed_limit"] or 0)
        except (TypeError, ValueError):
            return jsonify(error="speed_limit inválido"), 400
        if mbps > 0:
            c["speed_limit"] = min(mbps, 10000.0)
        else:
            c.pop("speed_limit", None)  # 0 ou vazio = sem limite
    if "quota_gb" in body:
        try:
            gb = float(body["quota_gb"] or 0)
        except (TypeError, ValueError):
            return jsonify(error="quota_gb inválido"), 400
        if gb > 0:
            c["quota_gb"] = gb
        else:
            c.pop("quota_gb", None)
    if "quota_period" in body:
        if body["quota_period"] not in PERIODS:
            return jsonify(error="quota_period inválido"), 400
        c["quota_period"] = body["quota_period"]
    if "quota_clock" in body:
        if body["quota_clock"] not in ("fichier", "local"):
            return jsonify(error="quota_clock inválido"), 400
        c["quota_clock"] = body["quota_clock"]
    if "quota_day" in body:
        try:
            c["quota_day"] = max(1, min(28, int(body["quota_day"])))
        except (TypeError, ValueError):
            return jsonify(error="quota_day inválido"), 400
    if "max_parallel" in body:
        try:
            c["max_parallel"] = max(1, min(10, int(body["max_parallel"])))
        except (TypeError, ValueError):
            return jsonify(error="max_parallel inválido"), 400
    save_cfg(c)
    with sem.cv:
        sem.cv.notify_all()  # se o limite subiu, os downloads em espera arrancam já
    return jsonify(ok=True)


@app.get("/api/folders")
def api_folders():
    try:
        require_selectable()
        p = resolve_dir(request.args.get("path", ""))
        dirs = sorted((d for d in os.listdir(p) if not d.startswith(".") and os.path.isdir(os.path.join(p, d))),
                      key=str.lower)
        rel = rel_dir(p)
        return jsonify(path=rel, parent=None if not rel else rel_dir(os.path.dirname(p)), dirs=dirs)
    except Exception as e:
        return jsonify(error=str(e)), 400


@app.post("/api/folders")
def api_mkdir():
    try:
        require_selectable()
        p = os.path.join(resolve_dir(request.json.get("path", "")), safe_name(request.json.get("name", "")))
        resolve_dir(rel_dir(os.path.realpath(p)))
        os.makedirs(p, exist_ok=True)
        return jsonify(path=rel_dir(os.path.realpath(p)))
    except Exception as e:
        return jsonify(error=str(e)), 400


@app.post("/api/dest")
def api_dest():
    """{path} escolhe uma pasta dentro de SELECTABLE_DIR; {reset: true} volta ao destino por defeito."""
    try:
        c = load_cfg()
        if request.json.get("reset"):
            c.pop("dest", None)
        else:
            require_selectable()
            p = resolve_dir(request.json.get("path", ""))
            if not os.path.isdir(p):
                raise ValueError("Pasta inexistente")
            c["dest"] = rel_dir(p)
        save_cfg(c)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 400


@app.get("/api/history")
def api_history():
    h = load_history()
    items = [dict(url=u, **{k: v[k] for k in ("filename", "rel", "date")}) for u, v in h.items()]
    return jsonify(items=sorted(items, key=lambda i: i["date"], reverse=True))


@app.post("/api/history/remove")
def api_history_remove():
    with lock:
        h = load_history()
        h.pop(request.json.get("url", ""), None)
        save_history(h)
    return jsonify(ok=True)


@app.post("/api/history/clear")
def api_history_clear():
    with lock:
        save_history({})
    return jsonify(ok=True)


@app.post("/api/list")
def api_list():
    try:
        groups = parse_groups(request.json["text"], request.json.get("folders", False))
        hist = load_history()
        for g in groups:
            for f in g["files"]:  # só conta como descarregado se o ficheiro ainda existir
                h = hist.get(f["url"])
                f["downloaded"] = bool(h and os.path.exists(h["path"]))
                f["downloaded_at"] = h["date"] if f["downloaded"] else ""
        return jsonify(groups=[describe_group(g) for g in groups])
    except Exception as e:
        return jsonify(error=str(e)), 400


@app.get("/api/tmdb")
def api_tmdb():
    try:
        data = tmdb_get("/search/tv", query=request.args.get("q", ""), language=request.args.get("lang", "en-US"))
        return jsonify(results=[
            {"id": r["id"], "name": r["name"], "original_name": r.get("original_name"),
             "year": (r.get("first_air_date") or "")[:4], "overview": (r.get("overview") or "")[:160]}
            for r in data.get("results", [])[:8]])
    except Exception as e:
        return jsonify(error=str(e)), 400


@app.post("/api/start")
def api_start():
    dest = current_dest()[0]
    for g in request.json["groups"]:
        series = (g.get("series") or "").strip()
        year = g.get("year") or ""
        year = year if re.fullmatch(r"\d{4}", year) else ""
        tmdb_id = str(g.get("tmdb_id") or "")
        tmdb_id = tmdb_id if tmdb_id.isdigit() else ""
        name_mode = g.get("name_mode") if g.get("name_mode") in NAME_MODES else "original"
        for f in g["files"]:
            job = dict(id=uuid.uuid4().hex[:8], url=f["url"], filename=f["filename"], size=f.get("size", 0),
                       done=0, speed=0, gen=0, status="queued", error="", series=series, year=year,
                       tmdb_id=tmdb_id, name_mode=name_mode, dest=dest)
            with lock:
                jobs[job["id"]] = job
            threading.Thread(target=run_job, args=(job, job["gen"]), daemon=True).start()
    return jsonify(ok=True)


@app.get("/api/jobs")
def api_jobs():
    return jsonify(list(jobs.values()))


def pause_job(job):
    with lock:
        if job["status"] in RUNNING:
            job["status"], job["paused_by"] = "paused", "user"
            job["gen"] += 1  # a thread atual para no próximo bloco
            job["speed"] = 0


def resume_job(job):
    with lock:
        if job["status"] != "paused":
            return
        job["status"], job["error"], job["paused_by"] = "queued", "", None
        job["gen"] += 1
        gen = job["gen"]
    threading.Thread(target=run_job, args=(job, gen), daemon=True).start()


@app.post("/api/cancel/<jid>")
def api_cancel(jid):
    with lock:
        if jid in jobs and jobs[jid]["status"] in ACTIVE:
            jobs[jid]["status"] = "canceled"
            jobs[jid]["gen"] += 1
    return jsonify(ok=True)


@app.post("/api/pause/<jid>")
def api_pause(jid):
    if jid in jobs:
        pause_job(jobs[jid])
    return jsonify(ok=True)


@app.post("/api/resume/<jid>")
def api_resume(jid):
    if jid in jobs:
        resume_job(jobs[jid])
    return jsonify(ok=True)


@app.post("/api/pause_all")
def api_pause_all():
    for j in list(jobs.values()):
        pause_job(j)
    return jsonify(ok=True)


@app.post("/api/resume_all")
def api_resume_all():
    for j in list(jobs.values()):
        resume_job(j)
    return jsonify(ok=True)


@app.post("/api/clear")
def api_clear():
    with lock:
        for k in [k for k, v in jobs.items() if v["status"] not in ACTIVE]:
            del jobs[k]
    return jsonify(ok=True)


threading.Thread(target=quota_watcher, daemon=True).start()
