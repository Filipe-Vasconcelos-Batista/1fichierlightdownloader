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

const finalPath = (f, g, mode) => {
  const name = seriesName(f, g)
  const ext = f.filename.includes('.') ? f.filename.slice(f.filename.lastIndexOf('.')) : ''
  const code = f.season == null ? '' : `S${pad(f.season)}E${pad(f.episode)}`
  let file = f.filename || f.url
  if (code && mode === 'episode') file = code + ext
  else if (code && mode === 'series') file = `${name} ${code}${ext}`
  if (!name) return file
  const folder = g.tmdbId && g.useTmdbId ? `${name} [tmdbid-${g.tmdbId}]` : name
  return f.season == null ? `${folder}/${file}` : `${folder}/Season ${pad(f.season)}/${file}`
}

const formatSE = (f) =>
  f.season == null ? '' : `S${pad(f.season)}E${pad(f.episode)}`

function HistoryModal({ t, onClose }) {
  const [items, setItems] = useState(null)
  const load = () => fetch('/api/history').then((r) => r.json()).then((j) => setItems(j.items))
  useEffect(() => {
    load()
  }, [])
  const remove = async (url) => {
    await post('/api/history/remove', { url })
    load()
  }
  const clear = async () => {
    await post('/api/history/clear')
    load()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t.history}</h3>
        {items && items.length === 0 && <p className="muted">{t.historyEmpty}</p>}
        <ul className="dirs">
          {(items || []).map((i) => (
            <li key={i.url} className="hist">
              <span>
                {i.rel}
                <br />
                <span className="muted">{i.date}</span>
              </span>
              <button className="secondary" title={t.remove} onClick={() => remove(i.url)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="row end">
          {items && items.length > 0 && (
            <button className="secondary" onClick={clear}>
              {t.clearHistory}
            </button>
          )}
          <button onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  )
}

function NameModeSelect({ value, onChange, t, disabled }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(t.nameModes).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  )
}

function FolderPicker({ t, current, hostRoot, onClose, onPick }) {
  const [path, setPath] = useState(current)
  const [data, setData] = useState({ path: current, parent: null, dirs: [] })
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')

  const load = async (p) => {
    const r = await fetch(`/api/folders?path=${encodeURIComponent(p)}`)
    const j = await r.json()
    if (j.error) return setError(j.error)
    setError('')
    setPath(j.path)
    setData(j)
  }

  useEffect(() => {
    load(current)
  }, [])

  const mkdir = async () => {
    if (!newName.trim()) return
    const r = await post('/api/folders', { path, name: newName })
    const j = await r.json()
    if (j.error) return setError(j.error)
    setNewName('')
    load(j.path)
  }

  const full = `${hostRoot}${path ? '/' + path : ''}`

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t.chooseFolder}</h3>
        <p className="muted path">{full}</p>
        {error && <p className="err">{error}</p>}
        <ul className="dirs">
          {data.parent !== null && (
            <li>
              <button className="secondary" onClick={() => load(data.parent)}>
                ⬆ ..
              </button>
            </li>
          )}
          {data.dirs.map((d) => (
            <li key={d}>
              <button className="secondary" onClick={() => load(path ? `${path}/${d}` : d)}>
                📁 {d}
              </button>
            </li>
          ))}
          {data.dirs.length === 0 && <li className="muted">{t.noSubfolders}</li>}
        </ul>
        <div className="row">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.newFolder} onKeyDown={(e) => e.key === 'Enter' && mkdir()} />
          <button className="secondary" onClick={mkdir}>
            {t.create}
          </button>
        </div>
        <div className="row end">
          <button className="secondary" onClick={onClose}>
            {t.close}
          </button>
          <button onClick={() => onPick(path)}>{t.useFolder}</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [lang, setLang] = useState(initialLang)
  const t = messages[lang]
  const [cfg, setCfg] = useState({ has_key: false, from_env: false })
  const [key, setKey] = useState('')
  const [text, setText] = useState('')
  const [folders, setFolders] = useState(false)
  const [groups, setGroups] = useState([])
  const [active, setActive] = useState(0)
  const [picking, setPicking] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [globalNames, setGlobalNames] = useState(true)
  const [globalMode, setGlobalMode] = useState('original')
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
          setActive(0)
          setGroups(j.groups.map((g) => ({ ...g, sel: Object.fromEntries(g.files.filter((f) => !f.downloaded).map((f) => [f.url, true])), filter: '', touched: false, choice: 0, custom: '', year: '', nameMode: 'original', tmdbId: '', useTmdbId: false, tmdbResults: null })))
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

  const pickDest = async (path) => {
    const r = await post('/api/dest', { path })
    const j = await r.json()
    if (!j.error) {
      setPicking(false)
      loadConfig()
    }
  }

  const resetDest = async () => {
    await post('/api/dest', { reset: true })
    loadConfig()
  }

  const updateGroup = (i, patch) =>
    setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, ...patch, touched: true } : g)))

  // Com um só grupo, ou com a opção geral ligada, o formato é o geral; senão, o de cada grupo
  const useGlobal = globalNames || groups.length < 2
  const nameModeOf = (g) => (useGlobal ? globalMode : g.nameMode)

  const toggleGlobal = (on) => {
    // ao desligar, cada grupo parte do formato geral que estava escolhido
    if (!on) setGroups((gs) => gs.map((g) => ({ ...g, nameMode: globalMode })))
    setGlobalNames(on)
  }

  const pending = groups.filter((g) => !g.touched).length

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
  const selectedFiles = groups.flatMap((g) => g.files.filter((f) => g.sel[f.url]))
  const selectedCount = selectedFiles.length
  const selectedSize = selectedFiles.reduce((n, f) => n + (f.size || 0), 0)
  const unknownSizes = selectedFiles.filter((f) => !f.size).length  // links sem tamanho conhecido

  // a seleção não conta como "opção definida" (não mexe no !)
  const patchGroup = (i, patch) => setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, ...patch } : g)))
  const visibleFiles = (g) => {
    const q = g.filter.trim().toLowerCase()
    return q ? g.files.filter((f) => `${f.filename} ${formatSE(f)}`.toLowerCase().includes(q)) : g.files
  }
  const setSelected = (i, files, on) => {
    const sel = { ...groups[i].sel }
    files.forEach((f) => (on ? (sel[f.url] = true) : delete sel[f.url]))
    patchGroup(i, { sel })
  }

  const start = async () => {
    await post('/api/start', {
      groups: groups
        .map((g) => ({ ...g, files: g.files.filter((f) => g.sel[f.url]) }))
        .filter((g) => g.files.length)
        .map((g) => ({
        files: g.files,
        series: effectiveName(g),
        year: g.year,
        tmdb_id: g.useTmdbId ? g.tmdbId : '',
        name_mode: nameModeOf(g),
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
          <button className="secondary icon" title={t.pauseAll} onClick={() => post('/api/pause_all')}>
            ⏸
          </button>
          <button className="secondary icon" title={t.resumeAll} onClick={() => post('/api/resume_all')}>
            ▶
          </button>
          <button className="secondary icon" title={t.clearFinished} onClick={() => post('/api/clear')}>
            🧹
          </button>
          <button className="secondary" onClick={() => setShowHistory(true)}>
            {t.history}
          </button>
          {['pt', 'en'].map((l) => (
            <button key={l} className={l === lang ? '' : 'secondary'} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {showHistory && <HistoryModal t={t} onClose={() => setShowHistory(false)} />}

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

      <div className="row">
        <span className="muted">
          📁 {t.destination}: <b>{cfg.dest_label}</b>
        </span>
        {cfg.selectable && (
          <>
            <button className="secondary" onClick={() => setPicking(true)}>
              {t.change}
            </button>
            {cfg.dest_rel != null && (
              <button className="secondary" onClick={resetDest}>
                {t.useDefault}
              </button>
            )}
          </>
        )}
      </div>
      {picking && (
        <FolderPicker t={t} current={cfg.dest_rel || ''} hostRoot={cfg.selectable_root} onClose={() => setPicking(false)} onPick={pickDest} />
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
          <b>{t.selectedOf(selectedCount, totalFiles)}</b>{' '}
          <button onClick={start} disabled={selectedCount === 0}>
            {t.downloadSelected}
            {selectedCount > 0 && ` (${formatSize(selectedSize)}${unknownSizes ? '+' : ''})`}
          </button>
          {pending > 0 && <span className="muted"> <span className="badge">!</span> {t.pendingCount(pending)}</span>}
        </p>
      )}

      {groups.length > 0 && (
        <div className="names global">
          <b>{t.fileNames}</b>
          <NameModeSelect value={globalMode} onChange={setGlobalMode} t={t} disabled={!useGlobal} />
          {groups.length > 1 && (
            <label className="muted">
              <input type="checkbox" checked={globalNames} onChange={(e) => toggleGlobal(e.target.checked)} /> {t.sameForAll}
            </label>
          )}
        </div>
      )}

      {groups.length > 1 && (
        <div className="tabs" role="tablist">
          {groups.map((g, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              className={i === active ? 'tab active' : 'tab'}
              onClick={() => setActive(i)}
              title={g.ref || effectiveName(g)}
            >
              <span className="tab-label">{effectiveName(g) || `${t.sources[g.kind]} ${i + 1}`}</span>
              {!g.touched && (
                <span className="badge" title={t.pending}>
                  !
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {groups.map((g, i) => i !== active ? null : (
        <section key={i} className="group">
          <h3>
            {t.sources[g.kind]} {groups.length > 1 && g.kind !== 'folder' ? i + 1 : ''}
            {g.ref && <span className="muted"> {g.ref}</span>} <span className="muted">· {t.files(g.files.length)}</span>
            {!g.touched && (
              <button className="secondary confirm" onClick={() => updateGroup(i, {})}>
                {t.confirm}
              </button>
            )}
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
            <button
              className="secondary"
              disabled={!cfg.has_tmdb}
              title={cfg.has_tmdb ? '' : t.tmdbNoKey}
              onClick={() => searchTmdb(i)}
            >
              {t.tmdbSearch}
            </button>
            {!cfg.has_tmdb && <span className="muted">⚠ {t.tmdbNoKey}</span>}
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

          {!useGlobal && (
            <div className="names">
              <b>{t.fileNames}</b>
              <NameModeSelect value={g.nameMode} onChange={(v) => updateGroup(i, { nameMode: v })} t={t} />
            </div>
          )}

          <div className="row">
            <input value={g.filter} onChange={(e) => patchGroup(i, { filter: e.target.value })} placeholder={t.filter} />
            <span className="muted nowrap">{t.selectedOf(g.files.filter((f) => g.sel[f.url]).length, g.files.length)}</span>
          </div>

          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    title={t.selectAll}
                    checked={visibleFiles(g).length > 0 && visibleFiles(g).every((f) => g.sel[f.url])}
                    onChange={(e) => setSelected(i, visibleFiles(g), e.target.checked)}
                  />
                </th>
                <th>{t.colName}</th>
                <th>{t.colSE}</th>
                <th>{t.colSize}</th>
                <th>{t.colFinal}</th>
              </tr>
            </thead>
            <tbody>
              {visibleFiles(g).map((f) => (
                <tr key={f.url}>
                  <td>
                    <input type="checkbox" checked={!!g.sel[f.url]} onChange={(e) => setSelected(i, [f], e.target.checked)} />
                  </td>
                  <td>
                    {f.filename || f.url}
                    {f.downloaded && (
                      <div className="muted">
                        ✓ {t.alreadyDownloaded} ({f.downloaded_at})
                      </div>
                    )}
                  </td>
                  <td>{formatSE(f)}</td>
                  <td className="muted nowrap">{formatSize(f.size)}</td>
                  <td className="muted">{finalPath(f, g, nameModeOf(g))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <h2>{t.downloads}</h2>
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
                <td className="nowrap">
                  {['queued', 'getting_link', 'downloading'].includes(j.status) && (
                    <button className="secondary icon" title={t.pause} onClick={() => post(`/api/pause/${j.id}`)}>
                      ⏸
                    </button>
                  )}
                  {j.status === 'paused' && (
                    <button className="secondary icon" title={t.resume} onClick={() => post(`/api/resume/${j.id}`)}>
                      ▶
                    </button>
                  )}{' '}
                  <button className="secondary icon" title={t.cancel} onClick={() => post(`/api/cancel/${j.id}`)}>
                    ✕
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <footer className="credit">
        <span className="muted">
          © {new Date().getFullYear()} Filipe Vasconcelos Batista ·{' '}
          <a href="mailto:filipevbatista1@gmail.com">filipevbatista1@gmail.com</a> ·{' '}
          <a href="https://github.com/Filipe-Vasconcelos-Batista" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
        {cfg.has_tmdb && (
          <div className="tmdb-credit">
            <img src="/tmdb-logo.svg" alt="TMDB" height="14" />
            <span className="muted">This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
          </div>
        )}
      </footer>
    </main>
  )
}
