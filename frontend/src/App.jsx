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

const formatSE = (f) =>
  f.season == null ? '' : `S${String(f.season).padStart(2, '0')}E${String(f.episode).padStart(2, '0')}`

export default function App() {
  const [lang, setLang] = useState(initialLang)
  const t = messages[lang]
  const [cfg, setCfg] = useState({ has_key: false, from_env: false })
  const [key, setKey] = useState('')
  const [text, setText] = useState('')
  const [folders, setFolders] = useState(false)
  const [series, setSeries] = useState('')
  const [files, setFiles] = useState([])
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
      setFiles([])
      setError('')
      return
    }
    const id = ++reqId.current
    const timer = setTimeout(async () => {
      setListing(true)
      try {
        const r = await post('/api/list', { text, folders, series })
        const j = await r.json()
        if (id !== reqId.current) return
        if (j.error) {
          setFiles([])
          setError(j.error)
        } else {
          setFiles(j.files)
          setError('')
        }
      } catch (e) {
        if (id === reqId.current) setError(String(e))
      } finally {
        if (id === reqId.current) setListing(false)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [text, folders, series])

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

  const start = async () => {
    await post('/api/start', { files, series })
    setText('')
  }

  const loadFile = async (e) => {
    const f = e.target.files[0]
    if (f) setText(await f.text())
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
          <input type="file" accept=".json,.txt" onChange={loadFile} hidden />
        </label>
        <label className="muted">
          <input type="checkbox" checked={folders} onChange={(e) => setFolders(e.target.checked)} />{' '}
          {t.linksAreFolders}
        </label>
      </div>
      <div className="row">
        <input value={series} onChange={(e) => setSeries(e.target.value)} placeholder={t.seriesName} />
      </div>

      {listing && <p className="muted">{t.loading}</p>}
      {error && <p className="err">{error}</p>}

      {files.length > 0 && (
        <section>
          <p>
            <b>{t.files(files.length)}</b> <button onClick={start}>{t.downloadAll}</button>
          </p>
          <table>
            <thead>
              <tr>
                <th>{t.colName}</th>
                <th>{t.colSE}</th>
                <th>{t.colSize}</th>
                <th>{t.colFolder}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.url}>
                  <td>{f.filename || f.url}</td>
                  <td>{formatSE(f)}</td>
                  <td className="muted nowrap">{formatSize(f.size)}</td>
                  <td className="muted">{f.folder}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

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
