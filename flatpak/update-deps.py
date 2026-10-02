#!/usr/bin/env python3
"""Gera flatpak/python-deps.json: as bibliotecas Python da app como wheels com URL e sha256 fixos.

O flatpak-builder constrói sem rede, por isso cada ficheiro tem de estar listado com o seu hash.
Corre isto sempre que mudares as dependências (ou para as actualizar):

    python3 flatpak/update-deps.py

Já vêm no runtime GNOME e por isso não se empacotam: jinja2, markupsafe, PyGObject.
"""
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON = "3.13"  # o do runtime org.gnome.Platform//50
REQUIREMENTS = ["flask", "requests", "pyyaml"]
IN_RUNTIME = {"jinja2", "markupsafe"}
PLATFORMS = {"x86_64": "manylinux2014_x86_64", "aarch64": "manylinux2014_aarch64"}


def pip_download(platform, dest):
    cmd = [sys.executable, "-m", "pip", "download", "--quiet", "--dest", dest, "--only-binary=:all:",
           "--python-version", PYTHON, "--implementation", "cp", "--platform", platform, "--platform", "any"]
    subprocess.run(cmd + REQUIREMENTS, check=True)
    return sorted(p.name for p in Path(dest).glob("*.whl"))


def pypi_file(wheel):
    name, version = wheel.split("-")[:2]
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json") as r:
        for f in json.load(r)["urls"]:
            if f["filename"] == wheel:
                return {"type": "file", "url": f["url"], "sha256": f["digests"]["sha256"]}
    raise SystemExit(f"{wheel} não encontrado no PyPI")


def main():
    sources = {}  # wheel -> (fonte, arquitecturas)
    for arch, platform in PLATFORMS.items():
        with tempfile.TemporaryDirectory() as tmp:
            for wheel in pip_download(platform, tmp):
                if wheel.split("-")[0].lower() in IN_RUNTIME:
                    continue
                src, arches = sources.setdefault(wheel, (pypi_file(wheel), []))
                arches.append(arch)
    files = []
    for wheel, (src, arches) in sorted(sources.items()):
        entry = dict(src)
        if set(arches) != set(PLATFORMS):  # wheel específica de uma arquitectura
            entry["only-arches"] = arches
        files.append(entry)
    module = {
        "name": "python-deps",
        "buildsystem": "simple",
        "build-commands": ["pip3 install --verbose --exists-action=i --no-index --no-deps --no-build-isolation "
                           "--prefix=${FLATPAK_DEST} ./*.whl"],
        "sources": files,
    }
    (HERE / "python-deps.json").write_text(json.dumps(module, indent=2) + "\n")
    print(f"{len(files)} wheels escritas em flatpak/python-deps.json")


if __name__ == "__main__":
    main()
