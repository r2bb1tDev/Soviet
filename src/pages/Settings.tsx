import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { useStore } from '../store'
import BearLogo from '../components/BearLogo'
import ShareCard from '../components/ShareCard'

export default function Settings() {
  const { identity, setPage, setIdentity, myStatus, setMyStatus, myAvatar, setMyAvatar, p2pPeers } = useStore()
  const [showShareCard, setShowShareCard] = useState(false)
  const [nickname, setNickname] = useState('')
  const [statusText, setStatusText] = useState('')
  const [notifySounds, setNotifySounds] = useState(true)
  const [lanEnabled, setLanEnabled] = useState(true)
  const [theme, setTheme] = useState('system')
  const [customId, setCustomId] = useState('')
  const [customIdError, setCustomIdError] = useState('')
  const [privKey, setPrivKey] = useState('')
  const [autoResponse, setAutoResponse] = useState('')
  const [historyEnabled, setHistoryEnabled] = useState(true)
  const [allowList, setAllowList] = useState('')
  const [denyList, setDenyList] = useState('')
  const [invisibleList, setInvisibleList] = useState('')
  const [ignoreList, setIgnoreList] = useState('')
  const [saved, setSaved] = useState(false)
  const [appVersion, setAppVersion] = useState('...')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [copiedPub, setCopiedPub] = useState(false)
  const [copiedPriv, setCopiedPriv] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(myAvatar)
  const [p2pPeerId, setP2pPeerId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    invoke<any>('get_settings').then(s => {
      setNickname(s.nickname)
      setStatusText(s.status_text)
      setNotifySounds(s.notify_sounds)
      setLanEnabled(s.lan_enabled)
      setTheme(s.theme)
      if (s.avatar_data) setAvatarPreview(s.avatar_data)
      if (s.custom_id) setCustomId(s.custom_id)
      setAutoResponse(s.auto_response ?? '')
      setHistoryEnabled(s.history_enabled !== false)
      setAllowList(s.allow_list ?? '')
      setDenyList(s.deny_list ?? '')
      setInvisibleList(s.invisible_list ?? '')
      setIgnoreList(s.ignore_list ?? '')
    })
    invoke<string>('export_keys').then(k => setPrivKey(k)).catch(() => {})
    invoke<any[]>('get_p2p_peers').then(peers => {
      if (peers.length > 0 && peers[0]?.peer_id) setP2pPeerId(peers[0].peer_id)
    }).catch(() => {})
    getVersion().then(setAppVersion).catch(() => setAppVersion('?'))
  }, [])

  const handleAvatarClick = () => fileInputRef.current?.click()

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setAvatarPreview(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const applyTheme = (t: string) => {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
    else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
  }

  const validateCustomId = (val: string) => {
    if (val.length === 0) return ''
    if (val.length < 3) return 'Минимум 3 символа'
    if (val.length > 10) return 'Максимум 10 символов'
    if (!/^[a-zA-Z0-9_]+$/.test(val)) return 'Только буквы, цифры и _'
    return ''
  }

  const handleCustomIdChange = (val: string) => {
    setCustomId(val)
    setCustomIdError(validateCustomId(val))
  }

  const save = async () => {
    const idErr = validateCustomId(customId)
    if (idErr) { setCustomIdError(idErr); return }
    try {
      await invoke('save_settings', {
        settings: {
          nickname,
          public_key: identity?.public_key ?? '',
          status: myStatus,
          status_text: statusText,
          lan_enabled: lanEnabled,
          notify_sounds: notifySounds,
          theme,
          avatar_data: avatarPreview ?? '',
          custom_id: customId,
          auto_response: autoResponse,
          history_enabled: historyEnabled,
          allow_list: allowList,
          deny_list: denyList,
          invisible_list: invisibleList,
          ignore_list: ignoreList,
        }
      })
      setMyAvatar(avatarPreview)
      if (identity) setIdentity({ ...identity, nickname })
      applyTheme(theme)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('save_settings error:', e)
    }
  }

  const copyKey = () => {
    navigator.clipboard.writeText(privKey)
    setCopiedPriv(true)
    setTimeout(() => setCopiedPriv(false), 2000)
  }
  const copyPub = () => {
    navigator.clipboard.writeText(identity?.public_key ?? '')
    setCopiedPub(true)
    setTimeout(() => setCopiedPub(false), 2000)
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <button className="btn-icon" onClick={() => setPage('main')} title="Назад">←</button>
        <span style={s.headerTitle}>Настройки</span>
      </div>

      <div style={s.body}>

        {/* ── Профиль (упрощённый) ── */}
        <Section title="Мой профиль">
          {/* Аватар */}
          <div style={s.avatarSection}>
            <div style={s.avatarWrap} onClick={handleAvatarClick} title="Нажмите для смены фото">
              {avatarPreview
                ? <img src={avatarPreview} style={s.avatarImg} />
                : <BearLogo size={64} />
              }
              <div style={s.avatarOverlay}>📷</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              Нажмите для смены фото
            </div>
            {avatarPreview && (
              <button className="btn-secondary" style={{ fontSize: 11, marginTop: 4 }}
                onClick={() => setAvatarPreview(null)}>
                Удалить фото
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />

          <Label>Отображаемое имя</Label>
          <input style={s.input} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Ваше имя" />

          <Label style={{ marginTop: 10 }}>Публичный ключ (ваш «номер»)</Label>
          <div style={s.keyRow}>
            <span style={s.keyText}>{identity?.public_key}</span>
            <button className="btn-icon" onClick={copyPub} title="Копировать">
              {copiedPub ? '✓' : '📋'}
            </button>
          </div>

          <button className="btn-secondary" style={{ ...s.qrBtn, marginTop: 12 }} onClick={() => setShowShareCard(true)}>
            📲 Мой QR-код / Поделиться
          </button>
        </Section>

        <button className="btn-primary" style={s.saveBtn} onClick={save}>
          {saved ? '✓ Сохранено' : 'Сохранить'}
        </button>

        {/* ── Расширенные настройки (свёрнуты) ── */}
        <div style={{ marginTop: 8 }}>
          <button
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              padding: '10px 14px', cursor: 'pointer', color: 'var(--text-secondary)',
              fontSize: 13, fontFamily: 'inherit',
            }}
            onClick={() => setShowAdvanced(v => !v)}
          >
            <span>⚙ Расширенные настройки</span>
            <span>{showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && (
            <>
              {/* Статус */}
              <Section title="Статус">
                <div style={s.statusRow}>
                  {(['online','away','na','dnd','invisible'] as const).map(st => (
                    <button key={st}
                      className={myStatus === st ? 'btn-primary' : 'btn-secondary'}
                      style={s.statusBtn}
                      onClick={() => setMyStatus(st)}>
                      <span className={`status-dot ${st}`} style={{marginRight:6}}/>
                      {{ online:'В сети', away:'Отошёл', na:'Недоступен', dnd:'Не беспокоить', invisible:'Невидимка' }[st]}
                    </button>
                  ))}
                </div>
                <Label style={{ marginTop: 10 }}>Текст статуса</Label>
                <input style={s.input} value={statusText}
                  placeholder="Например: Работаю над проектом"
                  onChange={e => setStatusText(e.target.value)} />
              </Section>

              {/* Ваш ID */}
              <Section title="Ваш короткий ID">
                <input style={s.input} value={customId}
                  placeholder="3–10 симв., a-z 0-9 _"
                  maxLength={10}
                  onChange={e => handleCustomIdChange(e.target.value)} />
                {customIdError && (
                  <div style={{ fontSize: 11, color: 'var(--error,#e53e3e)', marginTop: 2 }}>{customIdError}</div>
                )}
              </Section>

              {/* Приватный ключ */}
              <Section title="Резервная копия ключа">
                <div style={s.keyRow}>
                  <span style={{...s.keyText, filter:'blur(4px)', userSelect:'none'}}>{privKey}</span>
                  <button className="btn-icon" onClick={copyKey} title="Копировать">
                    {copiedPriv ? '✓' : '📋'}
                  </button>
                </div>
                <p style={s.hint}>⚠️ Никому не передавайте приватный ключ!</p>
              </Section>

              {/* Сеть */}
              <Section title="Сеть">
                <Toggle label="LAN-режим (без интернета)" value={lanEnabled} onChange={setLanEnabled} />
                <p style={s.hint}>Автообнаружение пользователей в локальной сети через mDNS</p>
                <div style={{ marginTop: 12 }}>
                  <Label>Интернет (P2P mesh + Nostr)</Label>
                  <div style={s.netRow}>
                    <span style={s.netLabel}>🌐 libp2p DHT</span>
                    <span style={{ ...s.netBadge, background: p2pPeers.length > 0 ? 'var(--accent)' : 'var(--bg-tertiary)', color: p2pPeers.length > 0 ? 'white' : 'var(--text-muted)' }}>
                      {p2pPeers.length > 0 ? `${p2pPeers.length} пиров` : 'поиск...'}
                    </span>
                  </div>
                  <div style={s.netRow}>
                    <span style={s.netLabel}>📡 Nostr relay</span>
                    <span style={{ ...s.netBadge, background: 'var(--accent)', color: 'white' }}>активен</span>
                  </div>
                  <div style={s.netRow}>
                    <span style={s.netLabel}>🔗 Relay серверы</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>damus · nos.lol · nostr.band</span>
                  </div>
                </div>
                {p2pPeerId && (
                  <div style={{ marginTop: 12 }}>
                    <Label>Ваш P2P ID</Label>
                    <div style={s.keyRow}>
                      <span style={s.keyText}>{p2pPeerId}</span>
                      <button className="btn-icon" onClick={() => navigator.clipboard.writeText(p2pPeerId)} title="Копировать">📋</button>
                    </div>
                  </div>
                )}
              </Section>

              {/* Интерфейс */}
              <Section title="Интерфейс">
                <Label>Тема</Label>
                <div style={s.radioRow}>
                  {(['system','light','dark'] as const).map(t => (
                    <button key={t}
                      className={theme === t ? 'btn-primary' : 'btn-secondary'}
                      style={s.radioBtn}
                      onClick={() => { setTheme(t); applyTheme(t) }}>
                      {{ system:'Авто', light:'Светлая', dark:'Тёмная' }[t]}
                    </button>
                  ))}
                </div>
                <Toggle label="Звуки уведомлений" value={notifySounds} onChange={setNotifySounds} />
              </Section>

              {/* Сообщения */}
              <Section title="Сообщения">
                <Toggle label="История сообщений" value={historyEnabled} onChange={setHistoryEnabled} />
                <Label style={{ marginTop: 10 }}>Автоответчик</Label>
                <textarea
                  style={{ ...s.input, height: 70, resize: 'none' }}
                  placeholder="Текст автоответа (если вы Away / DND)"
                  value={autoResponse}
                  onChange={e => setAutoResponse(e.target.value)}
                />
              </Section>

              {/* Приватность */}
              <Section title="Приватность">
                <Label>Белый список (по одному ключу на строку)</Label>
                <textarea style={{ ...s.input, height: 64, resize: 'none' }} value={allowList} onChange={e => setAllowList(e.target.value)} />
                <Label style={{ marginTop: 10 }}>Чёрный список</Label>
                <textarea style={{ ...s.input, height: 64, resize: 'none' }} value={denyList} onChange={e => setDenyList(e.target.value)} />
                <Label style={{ marginTop: 10 }}>Невидимка для (ключи)</Label>
                <textarea style={{ ...s.input, height: 64, resize: 'none' }} value={invisibleList} onChange={e => setInvisibleList(e.target.value)} />
                <Label style={{ marginTop: 10 }}>Игнор-лист</Label>
                <textarea style={{ ...s.input, height: 64, resize: 'none' }} value={ignoreList} onChange={e => setIgnoreList(e.target.value)} />
              </Section>

              <button className="btn-primary" style={s.saveBtn} onClick={save}>
                {saved ? '✓ Сохранено' : 'Сохранить'}
              </button>
            </>
          )}
        </div>

        <Section title="О приложении">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            <div><b>Soviet Messenger</b> v{appVersion}</div>
            <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 12 }}>
              Разработано командой <b style={{ color: 'var(--accent)' }}>FSOCIETY</b> × <b style={{ color: 'var(--accent)' }}>LURKHUB</b>
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Децентрализованный мессенджер без регистрации и серверов
            </div>
          </div>
        </Section>

        <div style={{ padding: '8px 0 16px' }}>
          {!confirmSignOut ? (
            <button
              style={{
                width: '100%', padding: '10px',
                background: 'rgba(229,62,62,0.08)', color: 'var(--error,#e53e3e)',
                border: '1px solid rgba(229,62,62,0.25)', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              }}
              onClick={() => setConfirmSignOut(true)}
            >
              🚪 Выйти из аккаунта
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--busy)', padding: '12px', background: 'rgba(229,62,62,0.05)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Выйти из аккаунта? Ваши данные останутся на устройстве.</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ flex: 1, fontSize: 13 }} onClick={() => setConfirmSignOut(false)}>Отмена</button>
                <button style={{ flex: 1, fontSize: 13, padding: '8px', background: 'var(--busy)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                  onClick={async () => {
                    try {
                      await invoke('sign_out')
                      useStore.getState().setPage('onboarding')
                      useStore.setState({ identity: null })
                    } catch (e) { console.error(e) }
                  }}>
                  Выйти
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showShareCard && identity && (
        <ShareCard
          nickname={nickname || identity.nickname}
          publicKey={identity.public_key}
          avatar={myAvatar}
          customId={customId || undefined}
          onClose={() => setShowShareCard(false)}
        />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sc.section}>
      <div style={sc.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <label style={{ ...sc.label, ...style }}>{children}</label>
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={sc.toggleRow} onClick={() => onChange(!value)}>
      <span style={sc.toggleLabel}>{label}</span>
      <div style={{ ...sc.toggle, background: value ? 'var(--accent)' : 'var(--bg-tertiary)' }}>
        <div style={{ ...sc.toggleKnob, transform: value ? 'translateX(18px)' : 'translateX(2px)' }} />
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display:'flex', flexDirection:'column', height:'100vh', background:'var(--bg-primary)' },
  avatarSection: {
    display:'flex', flexDirection:'column', alignItems:'center',
    marginBottom: 16,
  },
  avatarWrap: {
    width: 80, height: 80, borderRadius: '50%',
    background: 'var(--bg-tertiary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', position: 'relative', overflow: 'hidden',
    border: '2px solid var(--border)',
  },
  avatarImg: {
    width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%',
  },
  avatarOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    background: 'rgba(0,0,0,0.45)', color: 'white',
    fontSize: 16, textAlign: 'center', padding: '3px 0',
    opacity: 0,
    transition: 'opacity 0.2s',
  },
  header: {
    display:'flex', alignItems:'center', gap:12,
    padding:'12px 16px', borderBottom:'1px solid var(--border)',
    background:'var(--bg-secondary)', flexShrink:0,
  },
  headerTitle: { fontSize:16, fontWeight:600 },
  body: { flex:1, overflowY:'auto', padding:'16px 24px' },
  input: { width:'100%', marginBottom:4 },
  statusRow: { display:'flex', gap:6, flexWrap:'wrap', marginBottom:4 },
  statusBtn: { padding:'5px 10px', fontSize:12, display:'flex', alignItems:'center' },
  keyRow: {
    display:'flex', alignItems:'center', gap:8,
    background:'var(--bg-secondary)', borderRadius:8,
    padding:'8px 10px', border:'1px solid var(--border)',
  },
  keyText: { fontFamily:'monospace', fontSize:11, color:'var(--text-secondary)', flex:1, wordBreak:'break-all' },
  hint: { fontSize:12, color:'var(--text-muted)', marginTop:4 },
  radioRow: { display:'flex', gap:6 },
  radioBtn: { padding:'6px 14px', fontSize:13 },
  saveBtn: { marginTop:8, width:'100%' },
  qrBtn: { width:'100%', marginBottom:14, fontWeight:600 },
  netRow: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 0' },
  netLabel: { fontSize:13, color:'var(--text-secondary)' },
  netBadge: { fontSize:11, fontWeight:600, borderRadius:6, padding:'2px 8px' },
}

const sc: Record<string, React.CSSProperties> = {
  section: {
    marginBottom:24, background:'var(--bg-secondary)',
    borderRadius:12, padding:'16px', border:'1px solid var(--border)',
  },
  sectionTitle: { fontSize:12, fontWeight:600, textTransform:'uppercase',
    letterSpacing:'0.08em', color:'var(--text-muted)', marginBottom:12 },
  label: { display:'block', fontSize:12, color:'var(--text-secondary)', marginBottom:5 },
  toggleRow: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    cursor:'pointer', padding:'6px 0',
  },
  toggleLabel: { fontSize:14, color:'var(--text-primary)' },
  toggle: {
    width:38, height:22, borderRadius:11, position:'relative',
    transition:'background 0.2s', flexShrink:0,
  },
  toggleKnob: {
    position:'absolute', top:2,
    width:18, height:18, borderRadius:9,
    background:'white', transition:'transform 0.2s',
    boxShadow:'0 1px 4px rgba(0,0,0,0.2)',
  },
}
