import { useEffect, useRef, useState } from 'react'
import { initialLang, messages } from './i18n.js'

const post = (url, body = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const formatSize = (n) =>
  !n ? '?' : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`

const pad = (n) => String(n).padStart(2, '0')

// Nome efetivo da pasta de um grupo: o escolhido nas opções, o escrito, ou o detetado
const effectiveName = (g) =>
  g.names.length > 1 && g.choice !== 'custom' ? g.names[g.choice] : g.custom.trim() || g.names[0] || ''

// Espelham o backend: "Nome (Ano) [tmdbid-N]/Season NN/ficheiro"
const seriesName = (f, g) => {
  let name = effectiveName(g) || f.series
  if (name && /^\d{4}$/.test(g.year) && !/\(\d{4}\)$/.test(name)) name += ` (${g.year})`
  return name
}

const finalPath = (f, g) => {
  const name = seriesName(f, g)
  const ext = f.filename.includes('.') ? f.filename.slice(f.filename.lastIndexOf('.')) : ''
  const code = f.season == null ? '' : `S${pad(f.season)}E${pad(f.episode)}`
  let file = f.filename || f.url
  if (code && g.nameMode === 'episode') file = code + ext
  else if (code && g.nameMode === 'series') file = `${name} ${code}${ext}`
  if (!name) return file
  const folder = g.tmdbId && g.useTmdbId ? `${name} [tmdbid-${g.tmdbId}]` : name
  return f.season == null ? `${folder}/${file}` : `${folder}/Season ${pad(f.season)}/${file}`
}

const formatSE = (f) =>
  f.season == null ? '' : `S${pad(f.season)}E${pad(f.episode)}`

export default function App() {
  const [lang, setLang] = useState(initialLang)
  const t = messages[lang]
  const [cfg, setCfg] = useState({ has_key: false, from_env: false })
  const [key, setKey] = useState('')
  const [text, setText] = useState('')
  const [folders, setFolders] = useState(false)
  const [groups, setGroups] = useState([])
  const [listing, setListing] = useState(false)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState([])
  const reqId = useRef(0)

  const loadConfig = () =>
    fetch('/api/config').then((r) => r.json()).then(setCfg).catch(() => {})

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    try {
      localStorage.setItem('lang', lang)
    } catch {}
  }, [lang])

  // Lista automaticamente (com debounce) quando se cola ou altera o conteúdo
  useEffect(() => {
    if (!text.trim()) {
      setGroups([])
      setError('')
      return
    }
    const id = ++reqId.current
    const timer = setTimeout(async () => {
      setListing(true)
      try {
        const r = await post('/api/list', { text, folders })
        const j = await r.json()
        if (id !== reqId.current) return
        if (j.error) {
          setGroups([])
          setError(j.error)
        } else {
          setGroups(j.groups.map((g) => ({ ...g, choice: 0, custom: '', year: '', nameMode: 'original', tmdbId: '', useTmdbId: true, tmdbResults: null })))
          setError('')
        }
      } catch (e) {
        if (id === reqId.current) setError(String(e))
      } finally {
        if (id === reqId.current) setListing(false)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [text, folders])

  useEffect(() => {
    const tick = () =>
      fetch('/api/jobs').then((r) => r.json()).then(setJobs).catch(() => {})
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])

  const saveKey = async () => {
    if (!key) return
    await post('/api/config', { api_key: key })
    setKey('')
    loadConfig()
  }

  const updateGroup = (i, patch) =>
    setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, ...patch } : g)))

  const searchTmdb = async (i) => {
    const g = groups[i]
    const q = effectiveName(g) || g.files[0]?.series || ''
    const r = await fetch(`/api/tmdb?q=${encodeURIComponent(q)}&lang=${lang === 'pt' ? 'pt-PT' : 'en-US'}`)
    const j = await r.json()
    updateGroup(i, { tmdbResults: j.error ? [] : j.results, tmdbError: j.error || '' })
  }

  const pickTmdb = (i, r) =>
    updateGroup(i, {
      custom: r.name,
      choice: 'custom',
      year: r.year,
      tmdbId: String(r.id),
      tmdbResults: null,
    })

  const totalFiles = groups.reduce((n, g) => n + g.files.length, 0)

  const start = async () => {
    await post('/api/start', {
      groups: groups.map((g) => ({
        files: g.files,
        series: effectiveName(g),
        year: g.year,
        tmdb_id: g.useTmdbId ? g.tmdbId : '',
        name_mode: g.nameMode,
      })),
    })
    setText('')
  }

  const loadFiles = async (e) => {
    const texts = await Promise.all([...e.target.files].map((f) => f.text()))
    if (texts.length) setText(texts.join('\n'))
    e.target.value = ''
  }

  return (
    <main>
      <header>
        <h1>{t.title}</h1>
        <div className="lang">
          {['pt', 'en'].map((l) => (
            <button key={l} className={l === lang ? '' : 'secondary'} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {!cfg.from_env && (
        <div className="row">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={cfg.has_key ? t.apiKeySaved : t.apiKey}
          />
          <button onClick={saveKey}>{t.save}</button>
        </div>
      )}

      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.inputPlaceholder}
      />
      <div className="row">
        <label className="file secondary">
          {t.loadFile}
          <input type="file" accept=".json,.txt" multiple onChange={loadFiles} hidden />
        </label>
        <label className="muted">
          <input type="checkbox" checked={folders} onChange={(e) => setFolders(e.target.checked)} />{' '}
          {t.linksAreFolders}
        </label>
      </div>
      {listing && <p className="muted">{t.loading}</p>}
      {error && <p className="err">{error}</p>}

      {totalFiles > 0 && (
        <p>
          <b>{t.files(totalFiles)}</b> <button onClick={start}>{t.downloadAll}</button>
        </p>
      )}

      {groups.map((g, i) => (
        <section key={i} className="group">
          <h3>
            {t.sources[g.kind]} {groups.length > 1 && g.kind !== 'folder' ? i + 1 : ''}
            {g.ref && <span className="muted"> {g.ref}</span>} <span className="muted">· {t.files(g.files.length)}</span>
          </h3>

          <div className="names">
            <b>{t.folderName}</b>
            {g.names.length > 1 && (
              <>
                {g.names.map((n, k) => (
                  <label key={n}>
                    <input type="radio" name={`g${i}`} checked={g.choice === k} onChange={() => updateGroup(i, { choice: k, tmdbId: '' })} /> {n}
                  </label>
                ))}
                <label>
                  <input type="radio" name={`g${i}`} checked={g.choice === 'custom'} onChange={() => updateGroup(i, { choice: 'custom' })} />{' '}
                  {t.customName}
                </label>
              </>
            )}
            {(g.names.length <= 1 || g.choice === 'custom') && (
              <input
                value={g.custom}
                onChange={(e) => updateGroup(i, { custom: e.target.value, tmdbId: '', choice: g.names.length > 1 ? 'custom' : g.choice })}
                placeholder={t.altName(g.names[0])}
              />
            )}
            <input
              className="year"
              value={g.year}
              maxLength={4}
              inputMode="numeric"
              title={t.yearHint}
              onChange={(e) => updateGroup(i, { year: e.target.value.replace(/\D/g, '') })}
              placeholder={t.year}
            />
            {cfg.has_tmdb ? (
              <button className="secondary" onClick={() => searchTmdb(i)}>
                {t.tmdbSearch}
              </button>
            ) : (
              i === 0 && <span className="muted">{t.tmdbNoKey}</span>
            )}
            {g.tmdbId && (
              <label className="muted">
                <input type="checkbox" checked={g.useTmdbId} onChange={(e) => updateGroup(i, { useTmdbId: e.target.checked })} />{' '}
                {t.tmdbId} ({g.tmdbId})
              </label>
            )}
          </div>

          {g.tmdbResults && (
            <ul className="tmdb">
              {g.tmdbResults.length === 0 && <li className="muted">{g.tmdbError || t.tmdbNone}</li>}
              {g.tmdbResults.map((r) => (
                <li key={r.id}>
                  <button className="secondary" onClick={() => pickTmdb(i, r)}>
                    {r.name} {r.year && `(${r.year})`}
                  </button>
                  <span className="muted"> {r.overview}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="names">
            <b>{t.fileNames}</b>
            <select value={g.nameMode} onChange={(e) => updateGroup(i, { nameMode: e.target.value })}>
              {Object.entries(t.nameModes).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <table>
            <thead>
              <tr>
                <th>{t.colName}</th>
                <th>{t.colSE}</th>
                <th>{t.colSize}</th>
                <th>{t.colFinal}</th>
              </tr>
            </thead>
            <tbody>
              {g.files.map((f) => (
                <tr key={f.url}>
                  <td>{f.filename || f.url}</td>
                  <td>{formatSE(f)}</td>
                  <td className="muted nowrap">{formatSize(f.size)}</td>
                  <td className="muted">{finalPath(f, g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <h2>
        {t.downloads}{' '}
        <button className="secondary" onClick={() => post('/api/clear')}>
          {t.clearFinished}
        </button>
      </h2>
      <table>
        <tbody>
          {jobs.map((j) => {
            const pct = j.size ? Math.round((j.done / j.size) * 100) : 0
            return (
              <tr key={j.id}>
                <td>
                  {j.filename || j.url}
                  <div className="bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                </td>
                <td className="muted">
                  {t.status[j.status] ?? j.status}
                  {j.error && <span className="err"> {j.error}</span>}
                  <br />
                  {formatSize(j.done)} / {formatSize(j.size)}
                  {j.status === 'downloading' && ` · ${(j.speed / 1048576).toFixed(1)} MB/s`}
                </td>
                <td>
                  <button className="secondary" title={t.cancel} onClick={() => post(`/api/cancel/${j.id}`)}>
                    ✕
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}
