# 1fichier Light Downloader

🇵🇹 [Versão em português](README.pt.md)

A small app that runs in a Docker container and opens a web interface to download **many 1fichier files at once** from shared folders, JSON exports or lists of links, and organise them in the layout **Jellyfin** recognises (`Series (Year)/Season 01/...`). It needs a **1fichier Premium** account and its API key.

## Features

**Input**
- Paste a folder link (`https://1fichier.com/dir/...`), the folder's JSON (`?json=1|2`), the table copied from the browser, or a list of links (one per line)
- Paste or upload **several at once**: each source gets its own tab
- Files show up immediately, with name, season/episode and size

**Organisation (Jellyfin)**
- Detects series, season and episode in file names: `S01E01`, `1x05` and `Name - 05 - Title` (the last one assumes season 1)
- Per group, pick the folder name among the detected names or type another one, and set the year
- Optional **TMDB** search to fill in name and year, with the option to add `[tmdbid-N]` to the folder name
- File naming of your choice: original, `Series (Year) S01E01` or just `S01E01`, the same for all groups or per group
- Result: `Series (Year)/Season NN/file`

**Downloading**
- Choose which files to download: a checkbox per file and a filter (`S02`, `E05`, name…)
- **History**: files already downloaded are marked with ✓ and unchecked by default
- Parallel downloads with progress, speed, pause/resume and a cancel button
- Optional global speed limit (MB/s), set in **Settings (⚙)**
- Optional data limit per day, week, month or year: downloads pause when it is reached and resume on their own when the period renews
- Resumes interrupted downloads (`.part` files)
- Default destination folder, or one chosen inside the app (optional, see [Configuration](#configuration))

**General**
- Interface in Portuguese and English (PT/EN button)
- Your API key never goes into the code or the repository

## Requirements

- Docker and Docker Compose
- 1fichier Premium account and its API key (1fichier → *Parameters* → *API*)
- Optional: TMDB API key ([themoviedb.org](https://www.themoviedb.org) → *Settings* → *API*)

## Installation

```bash
git clone https://github.com/Filipe-Vasconcelos-Batista/1fichierlightdownloader.git
cd 1fichierlightdownloader
cp .env.example .env
```

Edit `.env`:

```env
DOWNLOAD_DIR=/home/your-user/Videos/1fichier
FICHIER_API_KEY=your_key_here
```

Start it:

```bash
docker compose up -d --build
```

To update later: `git pull` and `docker compose up -d --build`.

## Usage

1. Open <http://localhost:8080>
2. If you did not set `FICHIER_API_KEY` in `.env`, open **Settings (⚙)**, paste your 1fichier API key and save (a warning bar reminds you while it is missing)
3. Paste the folder link, the JSON or the list of links. The list appears on its own
4. For each group (tab), check the folder name, the year (you can use **Search TMDB**) and the file name format. An orange **!** marks groups you have not reviewed yet
5. Tick the files you want and click **Download selected**

Files end up in the destination, organised as `Series (Year)/Season NN/`.

## Configuration

All variables go in `.env`. The API keys and the number of simultaneous downloads are optional there: you can enter and change them any time in **Settings (⚙)**. A value saved in the app takes priority over the `.env` one.

| Variable | Required | Description |
|---|---|---|
| `DOWNLOAD_DIR` | yes | Folder on your computer where downloads are saved by default |
| `FICHIER_API_KEY` | no | Initial 1fichier API key. You can also set or change it in **Settings (⚙)** |
| `TMDB_API_KEY` | no | Initial TMDB key (v3 key or v4 token). Enables the **Search TMDB** button. Can also be set in **Settings (⚙)** |
| `SELECTABLE_DIR` | no | Folder on your computer (e.g. `/home/your-user` or `/mnt/media`) inside which you can pick the destination in the app with the **Change** button. If empty, the button is hidden and `DOWNLOAD_DIR` is always used |
| `TZ` | no | Your time zone (e.g. `Europe/Lisbon`), only used if you choose "My local time" for the data limit. Default: UTC |
| `MAX_PARALLEL` | no | Initial number of simultaneous downloads (default: 2). Can also be changed in **Settings (⚙)** |

About `SELECTABLE_DIR`: it gives the container write access to that folder, so choose the narrowest one possible. The app can only browse inside it.

## Data limit

In **Settings (⚙)** you can set a limit in GB per day, week (starting Monday), month or year. The app counts the bytes **this app** downloads (it cannot see other traffic on your PC or what 1fichier records on your account), so treat it as a brake, not an official meter. When the limit is reached, all downloads pause and resume on their own when the period renews or if you raise the limit. You can change the period at any time: usage is stored per day, so the count adjusts. By default the day changes at midnight **French time** (the 1fichier API states its dates are in CET/CEST); you can switch to your own time (`TZ` in `.env`). 1fichier's API does not expose when the traffic quota renews, so for a monthly limit you can set the day of the month the period starts on, to match the renewal date shown in your account.

## Stored data

An API key entered in the browser, the chosen destination and the download history live in a Docker volume (`fichier-config`). They survive `docker compose down` and updates, but are deleted by `docker compose down -v`.

## Notes

- The server only listens on `127.0.0.1:8080`. Do not expose it to the network without authentication: anyone who can reach it can use your API key.
- Run the app from your home connection. 1fichier blocks server, VPN and proxy IPs on Premium accounts.
- The container writes as `root`, so new files may be owned by that user. If that bothers you, fix it with `sudo chown -R $USER: <folder>`.
- If downloads fail while saving, check that Docker has write access to the destination folder.
- If two files in the same group end up with the same final name (for example 720p and 1080p versions of the same episode in the `S01E01` format), the second overwrites the first.

## Development

React + Vite frontend (`frontend/`), Flask backend (`app/`). Docker builds the frontend and Flask serves it.

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api to :8080
```

The backend runs in the container (`docker compose up -d --build`); in development, Vite forwards `/api` to it.

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, modify and share for non-commercial purposes. Selling it or using it commercially is not allowed.

## Author

Filipe Vasconcelos Batista · [filipevbatista1@gmail.com](mailto:filipevbatista1@gmail.com) · [GitHub](https://github.com/Filipe-Vasconcelos-Batista)

## Disclaimer

Unofficial project, not affiliated with 1fichier or TMDB. Use it only to download content you have the right to access.
This product uses the TMDB API but is not endorsed or certified by TMDB.
