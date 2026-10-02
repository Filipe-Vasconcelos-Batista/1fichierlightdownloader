import json
import os
import re
import threading
import time
import uuid

import requests
from flask import Flask, jsonify, request, send_from_directory

DOWNLOADS = "/downloads"
CONFIG = "/config/config.json"
API = "https://api.1fichier.com/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0"
ACTIVE = ("queued", "getting_link", "downloading")

app = Flask(__name__, static_folder="static", static_url_path="")
jobs = {}  # id -> dict
lock = threading.Lock()
sem = threading.Semaphore(int(os.environ.get("MAX_PARALLEL", "2")))


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


def get_key():
    return os.environ.get("FICHIER_API_KEY", "").strip() or load_cfg().get("api_key", "")


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


def parse_episode(filename):
    """'Título.S02E05...' -> ('Título', 2, 5); sem padrão -> ('', None, None)."""
    m = SERIES_RE.match(filename or "")
    if not m:
        return "", None, None
    return safe_name(re.sub(r"[._]+", " ", m.group(1)).strip()), int(m.group(2)), int(m.group(3))


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
    key = os.environ.get("TMDB_API_KEY", "").strip()
    if not key:
        raise RuntimeError("TMDB_API_KEY não definida")
    headers = {"Authorization": f"Bearer {key}"} if key.startswith("eyJ") else {}
    if not headers:
        params["api_key"] = key
    r = requests.get(f"https://api.themoviedb.org/3{path}", params=params, headers=headers, timeout=15)
    if r.status_code == 401:
        raise RuntimeError("TMDB: chave inválida")
    r.raise_for_status()
    return r.json()


def run_job(job):
    with sem:
        if job["status"] == "canceled":
            return
        try:
            job["status"] = "getting_link"
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
            job["status"] = "downloading"
            dest = os.path.join(DOWNLOADS, target_folder(job["filename"], job["series"], job["year"], job["tmdb_id"]),
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
                    for chunk in d.iter_content(1 << 20):
                        if job["status"] == "canceled":
                            return
                        f.write(chunk)
                        done += len(chunk)
                        job["done"] = done
                        job["speed"] = (done - base) / max(time.time() - t0, 0.001)
            os.replace(part, dest)
            job["status"] = "done"
        except Exception as e:
            job["status"] = "error"
            job["error"] = str(e)


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/config")
def get_config():
    return jsonify(has_key=bool(get_key()), from_env=bool(os.environ.get("FICHIER_API_KEY", "").strip()),
                   has_tmdb=bool(os.environ.get("TMDB_API_KEY", "").strip()))


@app.post("/api/config")
def set_config():
    c = load_cfg()
    c["api_key"] = request.json.get("api_key", "").strip()
    save_cfg(c)
    return jsonify(ok=True)


@app.post("/api/list")
def api_list():
    try:
        groups = parse_groups(request.json["text"], request.json.get("folders", False))
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
    for g in request.json["groups"]:
        series = (g.get("series") or "").strip()
        year = g.get("year") or ""
        year = year if re.fullmatch(r"\d{4}", year) else ""
        tmdb_id = str(g.get("tmdb_id") or "")
        tmdb_id = tmdb_id if tmdb_id.isdigit() else ""
        name_mode = g.get("name_mode") if g.get("name_mode") in NAME_MODES else "original"
        for f in g["files"]:
            job = dict(id=uuid.uuid4().hex[:8], url=f["url"], filename=f["filename"], size=f.get("size", 0),
                       done=0, speed=0, status="queued", error="", series=series, year=year,
                       tmdb_id=tmdb_id, name_mode=name_mode)
            with lock:
                jobs[job["id"]] = job
            threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return jsonify(ok=True)


@app.get("/api/jobs")
def api_jobs():
    return jsonify(list(jobs.values()))


@app.post("/api/cancel/<jid>")
def api_cancel(jid):
    if jid in jobs and jobs[jid]["status"] in ACTIVE:
        jobs[jid]["status"] = "canceled"
    return jsonify(ok=True)


@app.post("/api/clear")
def api_clear():
    with lock:
        for k in [k for k, v in jobs.items() if v["status"] not in ACTIVE]:
            del jobs[k]
    return jsonify(ok=True)
