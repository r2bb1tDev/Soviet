import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store'
import BearLogo from '../components/BearLogo'

export default function Onboarding() {
  const [step, setStep] = useState<'name' | 'keys' | 'import'>('name')
  const [nickname, setNickname] = useState('')
  const [pubKey, setPubKey] = useState('')
  const [importKey, setImportKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const { setIdentity, setPage } = useStore()

  const handleCreate = async () => {
    if (!nickname.trim()) { setError('Введите никнейм'); return }
    setLoading(true); setError('')
    try {
      const id = await invoke<{ nickname: string; public_key: string; has_identity: boolean }>(
        'create_identity', { nickname: nickname.trim() }
      )
      setPubKey(id.public_key)
      setStep('keys')
      setIdentity(id as any)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!importKey.trim()) { setError('Вставьте приватный ключ'); return }
    setLoading(true); setError('')
    try {
      const keyShort = importKey.trim().slice(0, 8)
      const id = await invoke<any>('import_keys', {
        encoded: importKey.trim(),
        nickname: `User_${keyShort}`
      })
      setIdentity(id)
      setPage('main')
    } catch (e) {
      setError('Неверный ключ: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(pubKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={s.root}>
      <div style={s.card}>
        {/* Логотип */}
        <div style={s.logoWrap}>
          <BearLogo size={80} />
          <div style={s.appName}>Soviet</div>
        </div>

        {step === 'name' && (
          <div style={s.section} className="fade-in">
            <h2 style={s.title}>Добро пожаловать!</h2>
            <p style={s.subtitle}>Введите никнейм — он будет виден другим пользователям</p>
            <input
              style={s.input}
              placeholder="Ваш никнейм"
              value={nickname}
              maxLength={32}
              onChange={e => setNickname(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            {error && <div style={s.error}>{error}</div>}
            <button className="btn-primary" style={s.btn} onClick={handleCreate} disabled={loading}>
              {loading ? 'Создание...' : 'Начать →'}
            </button>
            <button className="btn-secondary" style={{...s.btn, marginTop: 8}}
              onClick={() => setStep('import')}>
              Восстановить из ключей
            </button>
          </div>
        )}

        {step === 'keys' && (
          <div style={s.section} className="fade-in">
            <h2 style={s.title}>Ваши ключи сгенерированы!</h2>
            <p style={s.subtitle}>
              Это ваш публичный ключ — поделитесь им, чтобы другие могли добавить вас в контакты
            </p>
            <div style={s.keyBox}>
              <span style={s.keyText}>{pubKey}</span>
              <button className="btn-icon" onClick={copy} title="Копировать">
                {copied ? '✓' : '📋'}
              </button>
            </div>
            <div style={s.warning}>
              ⚠️ Сохраните резервную копию приватного ключа в безопасном месте!
            </div>
            <button className="btn-primary" style={s.btn} onClick={() => setPage('main')}>
              Готово ✓
            </button>
          </div>
        )}

        {step === 'import' && (
          <div style={s.section} className="fade-in">
            <h2 style={s.title}>Восстановление</h2>
            <p style={s.subtitle}>Введите ваш приватный ключ (Base58)</p>
            <textarea
              style={{...s.input, height: 80, resize: 'none', marginTop: 8}}
              placeholder="Приватный ключ..."
              value={importKey}
              onChange={e => setImportKey(e.target.value)}
            />
            {error && <div style={s.error}>{error}</div>}
            <button className="btn-primary" style={s.btn} onClick={handleImport} disabled={loading}>
              {loading ? 'Загрузка...' : 'Восстановить'}
            </button>
            <button className="btn-secondary" style={{...s.btn, marginTop: 8}}
              onClick={() => { setStep('name'); setError('') }}>
              ← Назад
            </button>
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
        FSOCIETY × LURKHUB
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: '100vw', height: '100vh',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-secondary)',
  },
  card: {
    background: 'var(--bg-primary)',
    borderRadius: 16,
    padding: '36px 40px',
    width: 380,
    boxShadow: '0 8px 32px var(--shadow)',
    border: '1px solid var(--border)',
  },
  logoWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    marginBottom: 28,
  },
  appName: {
    fontSize: 22, fontWeight: 700, marginTop: 10,
    color: 'var(--text-primary)',
    letterSpacing: '-0.3px',
  },
  section: { display: 'flex', flexDirection: 'column' },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 8 },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 },
  input: { width: '100%', marginBottom: 0 },
  btn: { marginTop: 14, width: '100%' },
  error: {
    color: 'var(--busy)', fontSize: 13, marginTop: 6,
    background: 'rgba(244,67,54,0.08)', padding: '6px 10px', borderRadius: 6,
  },
  keyBox: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 8, padding: '10px 12px',
    display: 'flex', alignItems: 'center', gap: 8,
    marginBottom: 12,
  },
  keyText: {
    fontFamily: 'monospace', fontSize: 12,
    color: 'var(--text-secondary)', wordBreak: 'break-all', flex: 1,
  },
  warning: {
    fontSize: 12, color: 'var(--away)',
    background: 'rgba(255,193,7,0.1)',
    padding: '8px 12px', borderRadius: 6, marginBottom: 4,
  },
}
