import { useEffect, useRef, useState } from 'react'
import { initialLang, messages } from './i18n.js'

const post = (url, body = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// Para consumos: zero é zero (formatSize devolve '?' para tamanhos desconhecidos)
const formatUsed = (n) => (n ? formatSize(n) : '0 MB')

const formatSize = (n) =>
  !n ? '?' : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`

// 3725 -> "1 h 02 min"; 310 -> "5 min 10 s"; 42 -> "42 s"
const formatDuration = (sec) => {
  sec = Math.round(sec)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s} s`
}

// Hora a que deve terminar: "14:35", ou com o dia se não for hoje
const formatEta = (sec, lang) => {
  const end = new Date(Date.now() + sec * 1000)
  const time = end.toLocaleTimeString(lang === 'pt' ? 'pt-PT' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  if (end.toDateString() === new Date().toDateString()) return time
  return `${end.toLocaleDateString(lang === 'pt' ? 'pt-PT' : 'en-GB', { day: '2-digit', month: '2-digit' })} ${time}`
}

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

function KeyField({ label, hint, info, t, value, onChange, onRemove }) {
  const status = { app: t.keyFromApp, env: t.keyFromEnv, none: t.keyNone }[info.source]
  return (
    <div className="field">
      <label>
        <b>{label}</b> <span className="muted">{hint}</span>
      </label>
      <div className="row">
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={info.set ? t.keyReplaceHint : ''}
        />
        {info.source === 'app' && (
          <button className="secondary" onClick={onRemove}>
            {t.removeKey}
          </button>
        )}
      </div>
      <span className={info.set ? 'muted' : 'err'}>{status}</span>
    </div>
  )
}

function SettingsModal({ t, onClose, onSaved }) {
  const [s, setS] = useState(null)
  const [fichierKey, setFichierKey] = useState('')
  const [tmdbKey, setTmdbKey] = useState('')
  const [maxParallel, setMaxParallel] = useState(2)
  const [saveError, setSaveError] = useState('')
  const [speedLimit, setSpeedLimit] = useState(0)
  const [quotaGb, setQuotaGb] = useState(0)
  const [quotaPeriod, setQuotaPeriod] = useState('month')
  const [quotaClock, setQuotaClock] = useState('fichier')
  const [quotaDay, setQuotaDay] = useState(1)
  const [rps, setRps] = useState(2)
  const [stopErrors, setStopErrors] = useState(5)
  const [diskMin, setDiskMin] = useState(0)
  const [diskWarn, setDiskWarn] = useState(0)
  const [netDetect, setNetDetect] = useState(true)

  const load = () =>
    fetch('/api/settings').then((r) => r.json()).then((j) => {
      setS(j)
      setMaxParallel(j.max_parallel)
      setSpeedLimit(j.speed_limit)
      setQuotaGb(j.quota_gb)
      setQuotaPeriod(j.quota_period)
      setQuotaClock(j.quota_clock)
      setQuotaDay(j.quota_day)
      setRps(j.requests_per_second)
      setStopErrors(j.stop_after_errors)
      setDiskMin(j.disk_min_free_gb)
      setDiskWarn(j.disk_warn_free_gb)
      setNetDetect(j.network_detect)
    })
  useEffect(() => {
    load()
  }, [])

  const remove = async (field) => {
    await post('/api/settings', { [field]: '' })
    await load()
    onSaved()
  }

  const resetUsage = async () => {
    await post('/api/usage/reset')
    load()
  }

  const save = async () => {
    const body = { max_parallel: maxParallel, speed_limit: speedLimit, quota_gb: quotaGb, quota_period: quotaPeriod, quota_clock: quotaClock, quota_day: quotaDay, requests_per_second: rps, stop_after_errors: stopErrors, disk_min_free_gb: diskMin, disk_warn_free_gb: diskWarn, network_detect: netDetect }
    if (fichierKey.trim()) body.fichier_api_key = fichierKey
    if (tmdbKey.trim()) body.tmdb_api_key = tmdbKey
    const r = await post('/api/settings', body)
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      setSaveError(j.error || 'Error')
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t.settings}</h3>
        {s && (
          <>
            <h4>{t.sectionKeys}</h4>
            <KeyField
              label={t.fichierKey}
              hint={t.fichierKeyHint}
              info={s.fichier}
              t={t}
              value={fichierKey}
              onChange={setFichierKey}
              onRemove={() => remove('fichier_api_key')}
            />
            <KeyField
              label={t.tmdbKey}
              hint={t.tmdbKeyHint}
              info={s.tmdb}
              t={t}
              value={tmdbKey}
              onChange={setTmdbKey}
              onRemove={() => remove('tmdb_api_key')}
            />
            <h4>{t.sectionData}</h4>
            <div className="field">
              <label>
                <b>{t.quota}</b> <span className="muted">{t.quotaHint}</span>
              </label>
              <div className="row">
                <input type="number" min="0" step="1" className="year" value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)} />
                <span className="muted">GB</span>
                <select value={quotaPeriod} onChange={(e) => setQuotaPeriod(e.target.value)}>
                  {Object.entries(t.periods).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <select value={quotaClock} onChange={(e) => setQuotaClock(e.target.value)}>
                  <option value="fichier">{t.clockFichier}</option>
                  <option value="local">{t.clockLocal}</option>
                </select>
                {quotaPeriod === 'month' && (
                  <>
                    <span className="muted">{t.monthStartsOn}</span>
                    <input type="number" min="1" max="28" className="year" value={quotaDay} onChange={(e) => setQuotaDay(e.target.value)} />
                  </>
                )}
              </div>
              <span className="muted small">{t.quotaNote}</span>
              <br />
              <span className="muted">
                {t.usedIn[quotaPeriod]}: {formatUsed(s.usage.used)} ·{' '}
                <button className="link" onClick={resetUsage}>
                  {t.resetCounter}
                </button>
              </span>
            </div>
            <h4>{t.sectionApi}</h4>
            <div className="field">
              <label>
                <b>{t.rps}</b> <span className="muted">{t.rpsHint}</span>
              </label>
              <div className="row">
                <input type="number" min="0.2" max="3" step="0.5" className="year" value={rps} onChange={(e) => setRps(e.target.value)} />
                <span className="muted">{t.perSecond}</span>
              </div>
            </div>
            <div className="field">
              <label>
                <b>{t.stopErrors}</b> <span className="muted">{t.stopErrorsHint}</span>
              </label>
              <div className="row">
                <input type="number" min="0" max="100" className="year" value={stopErrors} onChange={(e) => setStopErrors(e.target.value)} />
              </div>
            </div>
            <h4>{t.sectionDisk}</h4>
            <div className="field">
              <label>
                <b>{t.diskMin}</b> <span className="muted">{t.diskMinHint}</span>
              </label>
              <div className="row">
                <input type="number" min="0" step="1" className="year" value={diskMin} onChange={(e) => setDiskMin(e.target.value)} />
                <span className="muted">GB</span>
              </div>
            </div>
            <div className="field">
              <label>
                <b>{t.diskWarn}</b> <span className="muted">{t.diskWarnHint}</span>
              </label>
              <div className="row">
                <input type="number" min="0" step="1" className="year" value={diskWarn} onChange={(e) => setDiskWarn(e.target.value)} />
                <span className="muted">GB</span>
              </div>
            </div>
            <h4>{t.sectionNetwork}</h4>
            <div className="field">
              <label>
                <input type="checkbox" checked={netDetect} onChange={(e) => setNetDetect(e.target.checked)} /> <b>{t.netDetect}</b>
              </label>
              <span className="muted small">{t.netDetectHint}</span>
            </div>
            <h4>{t.sectionDownloads}</h4>
            <div className="field">
              <label>
                <b>{t.speedLimit}</b> <span className="muted">{t.speedLimitHint}</span>
              </label>
              <div className="row">
                <input type="number" min="0" step="0.5" className="year" value={speedLimit} onChange={(e) => setSpeedLimit(e.target.value)} />
                <span className="muted">MB/s</span>
              </div>
            </div>
            <div className="field">
              <label>
                <b>{t.maxParallel}</b>
              </label>
              <div className="row">
                <input type="number" min="1" max="10" className="year" value={maxParallel} onChange={(e) => setMaxParallel(e.target.value)} />
              </div>
            </div>
          </>
        )}
        {s && (
          <p className="muted small">
            {t.settingsFile}: <code>{s.settings_file}</code>
          </p>
        )}
        {s?.settings_error && <p className="err">{s.settings_error}</p>}
        {saveError && <p className="err">{saveError}</p>}
        <div className="row end">
          <button className="secondary" onClick={onClose}>
            {t.close}
          </button>
          <button onClick={save}>{t.save}</button>
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

// Dentro da janela de ambiente de trabalho (Flatpak), o Python expõe este canal para abrir o diálogo de pastas do sistema
const nativeBridge = () => window.webkit?.messageHandlers?.chooseFolder

export default function App() {
  const [lang, setLang] = useState(initialLang)
  const t = messages[lang]
  const [cfg, setCfg] = useState({})
  const [showSettings, setShowSettings] = useState(false)
  const [usage, setUsage] = useState(null)
  const [limits, setLimits] = useState(null)
  const [view, setView] = useState('add')
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [avgSpeed, setAvgSpeed] = useState(0) // velocidade total suavizada (bytes/s)
  const [lastSpeed, setLastSpeed] = useState(0) // última velocidade conhecida, para estimar novas seleções
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
    if (location.hash === '#settings') setShowSettings(true)
    window.addEventListener('ld-dest-changed', loadConfig)
    return () => window.removeEventListener('ld-dest-changed', loadConfig)
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
    const tick = () => fetch('/api/limits').then((r) => r.json()).then(setLimits).catch(() => {})
    tick()
    const iv = setInterval(tick, 3000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const tick = () => fetch('/api/usage').then((r) => r.json()).then(setUsage).catch(() => {})
    tick()
    const iv = setInterval(tick, 3000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const tick = () =>
      fetch('/api/jobs').then((r) => r.json()).then(setJobs).catch(() => {})
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])

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

  const openJobs = jobs.filter((j) => ['queued', 'getting_link', 'downloading', 'paused'].includes(j.status))
  const running = jobs.filter((j) => j.status === 'downloading')
  const waiting = jobs.filter((j) => ['queued', 'getting_link'].includes(j.status)).length
  const pausedCount = jobs.filter((j) => j.status === 'paused').length
  const totalSpeed = running.reduce((n, j) => n + (j.speed || 0), 0)

  // A velocidade medida noutra rede não serve para estimar esta
  const netId = limits?.speed?.network?.id
  useEffect(() => {
    setLastSpeed(0)
  }, [netId])

  // Velocidade total suavizada (média móvel), para o tempo restante não saltar a cada segundo
  const rawSpeed = running.reduce((n, j) => n + (j.speed || 0), 0)
  useEffect(() => {
    setAvgSpeed((prev) => (rawSpeed <= 0 ? 0 : prev > 0 ? prev * 0.7 + rawSpeed * 0.3 : rawSpeed))
    if (rawSpeed > 0) setLastSpeed(rawSpeed)
  }, [jobs])

  // O que falta descarregar (só conta ficheiros de tamanho conhecido)
  const remainingBytes = openJobs.reduce((n, j) => n + Math.max((j.size || 0) - (j.done || 0), 0), 0)
  const unknownRemaining = openJobs.filter((j) => !j.size).length
  const histSpeed = limits?.speed?.avg || 0 // média das últimas sessões desta rede (guardada em ficheiro)
  const net = limits?.speed?.network
  const netName = net && net.id !== 'unknown' ? `${net.name || net.id}${net.name && net.id.startsWith('AS') ? ` (${net.id})` : ''}` : ''
  const networkTooltip = (limits?.speed?.networks || [])
    .map((n) => `${n.current ? '▶ ' : ''}${n.name || n.id}: ${n.avg ? formatSize(n.avg) + '/s' : '—'} (${n.sessions})`)
    .join('\n')
  // Se ainda não há velocidade medida (a arrancar), usa a média histórica como estimativa inicial
  const fallback = avgSpeed <= 0 && waiting > 0 && histSpeed > 0
  const etaSpeed = avgSpeed > 0 ? avgSpeed : fallback ? histSpeed : 0
  const secondsLeft = etaSpeed > 0 ? remainingBytes / etaSpeed : null

  // Arrastar para reordenar: os downloads arrancam de cima para baixo
  const dropOn = async (targetId) => {
    const ids = jobs.map((j) => j.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    setDragId(null)
    setOverId(null)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setJobs(ids.map((id) => jobs.find((j) => j.id === id))) // mostra já a nova ordem, sem esperar pelo servidor
    await post('/api/reorder', { ids })
  }

  // Posição de cada download que ainda espera (o que está a descarregar não conta)
  const queuePos = {}
  jobs.filter((j) => j.status === 'queued').forEach((j, n) => (queuePos[j.id] = n + 1))

  const totalFiles = groups.reduce((n, g) => n + g.files.length, 0)
  const selectedFiles = groups.flatMap((g) => g.files.filter((f) => g.sel[f.url]))
  const selectedCount = selectedFiles.length
  const selectedSize = selectedFiles.reduce((n, f) => n + (f.size || 0), 0)
  // Cabe no disco? (os tamanhos desconhecidos não entram na conta)
  const disk = limits?.disk
  const afterFree = disk ? disk.free - selectedSize : null
  const diskCheck = !disk || selectedCount === 0 ? null
    : afterFree < 0 ? 'nofit'
    : disk.min_free > 0 && afterFree < disk.min_free ? 'belowmin'
    : disk.warn_free > 0 && afterFree < disk.warn_free ? 'near'
    : null
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
    const started = await post('/api/start', {
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
    if (started.ok) {
      setText('')
      setView('downloads')
    } else {
      const j = await started.json().catch(() => ({}))
      setError(j.error || `HTTP ${started.status}`) // ex.: o destino não está disponível
    }
  }

  const loadFiles = async (e) => {
    const texts = await Promise.all([...e.target.files].map((f) => f.text()))
    if (texts.length) setText(texts.join('\n'))
    e.target.value = ''
  }

  return (
    <main>
      <header>
        <div className="brand">
          <img src="/icon-192.png" alt="" width="44" height="44" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div>
            <h1>{t.title}</h1>
            <span className="muted small">{t.tagline}</span>
          </div>
        </div>
        <div className="lang">
          <button className="secondary" onClick={() => setShowHistory(true)}>
            {t.history}
          </button>
          <button className="secondary icon" title={t.settings} onClick={() => setShowSettings(true)}>
            ⚙
          </button>
          {['pt', 'en'].map((l) => (
            <button key={l} className={l === lang ? '' : 'secondary'} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="tabs main-tabs" role="tablist">
        <button role="tab" aria-selected={view === 'add'} className={view === 'add' ? 'tab active' : 'tab'} onClick={() => setView('add')}>
          {t.tabAdd}
        </button>
        <button role="tab" aria-selected={view === 'downloads'} className={view === 'downloads' ? 'tab active' : 'tab'} onClick={() => setView('downloads')}>
          {t.tabDownloads}
          {openJobs.length > 0 && <span className="count">{openJobs.length}</span>}
        </button>
      </div>

      {showSettings && <SettingsModal t={t} onClose={() => setShowSettings(false)} onSaved={loadConfig} />}
      {showHistory && <HistoryModal t={t} onClose={() => setShowHistory(false)} />}

      {cfg.dest_missing && (
        <div className="row warn bad">
          <span>⛔ {t.destMissing(cfg.dest_label)}</span>
        </div>
      )}
      {limits?.api?.tripped && (
        <div className="row warn bad">
          <span>⛔ {t.apiTripped(limits.api.limit)}</span>
          <button onClick={() => post('/api/resume_all')}>{t.resumeAll}</button>
        </div>
      )}
      {limits?.disk?.low && (
        <div className="row warn bad">
          <span>⛔ {t.diskLow(formatSize(limits.disk.free), formatSize(limits.disk.min_free))}</span>
        </div>
      )}
      {limits?.disk?.near && (
        <div className="row warn">
          <span>⚠ {t.diskNear(formatSize(limits.disk.free), formatSize(limits.disk.warn_free))}</span>
        </div>
      )}
      {limits?.settings_error && (
        <div className="row warn">
          <span>⚠ {limits.settings_error}</span>
        </div>
      )}
      {cfg.has_key === false && (
        <div className="row warn">
          <span>⚠ {t.missingKey}</span>
          <button onClick={() => setShowSettings(true)}>{t.openSettings}</button>
        </div>
      )}

      {view === 'add' && (
        <>
      <div className="row">
        <span className="muted">
          📁 {t.destination}: <b>{cfg.dest_label}</b>
        </span>
        {(cfg.selectable || (cfg.native && nativeBridge())) && (
          <>
            <button className="secondary" onClick={() => (cfg.native ? nativeBridge().postMessage('') : setPicking(true))}>
              {t.change}
            </button>
            {(cfg.native ? cfg.dest_custom : cfg.dest_rel != null) && (
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
          {selectedCount > 0 && selectedSize > 0 && (lastSpeed > 0 || histSpeed > 0) && (
            <span className="muted">
              {' '}
              ≈ {formatDuration(selectedSize / (lastSpeed || histSpeed))}{' '}
              {lastSpeed > 0 ? t.atSpeed(formatSize(lastSpeed)) : t.atHistSpeed(formatSize(histSpeed))}
            </span>
          )}
          {diskCheck && (
            <span className={diskCheck === 'near' ? 'warn-text' : 'err'}>
              {' '}
              {diskCheck === 'near' ? '⚠' : '⛔'} {t.diskCheck[diskCheck](formatSize(disk.free), formatSize(selectedSize), formatSize(afterFree))}
            </span>
          )}
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
        </>
      )}

      {view === 'downloads' && (
        <>
          <div className="toolbar">
            <button className="secondary icon" title={t.pauseAll} onClick={() => post('/api/pause_all')}>
              ⏸
            </button>
            <button className="secondary icon" title={t.resumeAll} onClick={() => post('/api/resume_all')}>
              ▶
            </button>
            <button className="secondary icon" title={t.clearFinished} onClick={() => post('/api/clear')}>
              🧹
            </button>
            <span className="muted">{t.summary(running.length, waiting, pausedCount, formatSize(totalSpeed))}</span>
          </div>
          {jobs.length > 1 && <p className="muted small">⠿ {t.dragHint}</p>}
          {netName && (
            <p className="muted small" title={networkTooltip}>
              🌐 {netName}
              {' · '}
              {histSpeed > 0 ? t.histAvg(formatSize(histSpeed), limits.speed.used) : t.noHistory}
            </p>
          )}
          {openJobs.length > 0 && (
            <div className="eta">
              <span>
                {t.remaining}: <b>{formatSize(remainingBytes)}{unknownRemaining ? '+' : ''}</b>
              </span>
              <span>
                {t.timeLeft}: <b>{secondsLeft != null ? `${fallback ? '~' : ''}${unknownRemaining ? '≥ ' : ''}${formatDuration(secondsLeft)}` : '—'}</b>
              </span>
              <span>
                {t.finishesAt}: <b>{secondsLeft != null ? formatEta(secondsLeft, lang) : '—'}</b>
              </span>
            </div>
          )}
      {usage && (usage.limit > 0 || usage.used > 0) && (
        <div className={usage.exceeded ? 'usage warn' : 'usage'}>
          <span className="muted">
            {t.usedIn[usage.period]}: <b>{formatUsed(usage.used)}</b>
            {usage.limit > 0 && ` / ${formatSize(usage.limit)}`}
          </span>
          {usage.limit > 0 && (
            <div className="bar">
              <i style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }} />
            </div>
          )}
          {usage.exceeded && <span>⚠ {t.quotaReached(usage.resets)}</span>}
        </div>
      )}
          {jobs.length === 0 && <p className="muted">{t.noDownloads}</p>}
      <table>
        <tbody>
          {jobs.map((j, idx) => {
            const pct = j.size ? Math.round((j.done / j.size) * 100) : 0
            const above = dragId && jobs.findIndex((x) => x.id === dragId) > idx
            const cls = [
              dragId === j.id ? 'dragging' : '',
              overId === j.id && dragId && dragId !== j.id ? (above ? 'drop-above' : 'drop-below') : '',
            ].join(' ')
            return (
              <tr
                key={j.id}
                className={cls}
                draggable
                onDragStart={(e) => {
                  setDragId(j.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', j.id) // o Firefox só arrasta se houver dados
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (overId !== j.id) setOverId(j.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOn(j.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
              >
                <td className="drag muted nowrap" title={t.dragHint}>
                  ⠿ {idx + 1}
                </td>
                <td>
                  {j.status === 'done' && <span className="ok" title={t.status.done}>✓ </span>}
                  {j.filename || j.url}
                  {j.status !== 'done' && (
                    <div className={`bar ${j.status === 'error' ? 'bar-error' : j.status === 'paused' ? 'bar-paused' : ''}`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </td>
                <td className={j.status === 'done' ? 'ok' : 'muted'}>
                  {j.status === 'paused' && ['quota', 'disk', 'api'].includes(j.paused_by) ? t.status[`paused_${j.paused_by}`] : (t.status[j.status] ?? j.status)}
                  {queuePos[j.id] && <span> · {t.queuePos(queuePos[j.id])}</span>}
                  {j.error && <span className="err"> {j.error}</span>}
                  <br />
                  {formatSize(j.done)} / {formatSize(j.size)}
                  {j.status === 'downloading' && ` · ${(j.speed / 1048576).toFixed(1)} MB/s`}
                  {j.status === 'downloading' && j.size > j.done && j.speed > 0 && ` · ${t.left} ${formatDuration((j.size - j.done) / j.speed)}`}
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
                  )}
                  {['error', 'canceled'].includes(j.status) && (
                    <button className="secondary icon" title={t.retry} onClick={() => post(`/api/retry/${j.id}`)}>
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
        </>
      )}

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
