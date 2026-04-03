import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import BearLogo from './BearLogo'

interface Props {
  nickname: string
  publicKey: string
  avatar?: string | null
  customId?: string
  onClose: () => void
}

// Первые 8 символов ключа — короткий ID для быстрого распознавания
export function shortId(pk: string) {
  return pk.slice(0, 8)
}

// Формат приглашения который автоматически парсится в AddContactModal
export function makeInviteText(nickname: string, publicKey: string, customId?: string) {
  const base = `Soviet | ${nickname} | ${publicKey}`
  return customId ? `${base} | @${customId}` : base
}

export default function ShareCard({ nickname, publicKey, avatar, customId, onClose }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const inviteData = makeInviteText(nickname, publicKey, customId)
    QRCode.toDataURL(inviteData, {
      width: 256,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    }).then(setQrDataUrl).catch(() => {})
  }, [nickname, publicKey, customId])

  const copyInvite = async () => {
    await navigator.clipboard.writeText(makeInviteText(nickname, publicKey, customId))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyKey = async () => {
    await navigator.clipboard.writeText(publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.card} className="fade-in">
        <div style={s.header}>
          <span style={s.title}>Мой контакт</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Аватар + имя */}
        <div style={s.profile}>
          <div style={s.avatarWrap}>
            {avatar
              ? <img src={avatar} style={s.avatarImg} />
              : <BearLogo size={56} />
            }
          </div>
          <div style={s.name}>{nickname}</div>
          {customId && (
            <div style={{ ...s.shortId, background: 'rgba(128,0,255,0.12)', color: '#9b59b6', marginBottom: 4 }}>@{customId}</div>
          )}
        </div>

        {/* QR-код */}
        <div style={s.qrWrap}>
          {qrDataUrl
            ? <img src={qrDataUrl} style={s.qr} alt="QR-код" />
            : <div style={s.qrPlaceholder}>...</div>
          }
          <div style={s.qrHint}>
            Покажи этот экран или отправь скриншот другому пользователю
          </div>
        </div>

        {/* Публичный ключ */}
        <div style={s.keySection}>
          <div style={s.keyLabel}>Публичный ключ</div>
          <div style={s.keyBox}>
            <span style={s.keyText}>{publicKey}</span>
            <button className="btn-icon" onClick={copyKey} title="Копировать ключ">📋</button>
          </div>
        </div>

        {/* Кнопки */}
        <div style={s.actions}>
          <button className="btn-primary" style={s.shareBtn} onClick={copyInvite}>
            {copied ? '✓ Скопировано!' : '📤 Копировать приглашение'}
          </button>
        </div>

        <div style={s.hint}>
          Приглашение — текст вида <b>Soviet | {nickname} | ...</b><br/>
          Другой пользователь вставляет его в «Добавить контакт» — все поля заполнятся сами
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 300,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 18, padding: '24px 28px',
    width: 360, boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
    maxHeight: '90vh', overflowY: 'auto',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { fontSize: 17, fontWeight: 700 },
  profile: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    marginBottom: 16,
  },
  avatarWrap: {
    width: 64, height: 64, borderRadius: '50%',
    background: 'var(--bg-secondary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: 8,
    border: '2px solid var(--border)',
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  name: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' },
  shortId: {
    fontSize: 13, color: 'var(--text-muted)',
    fontFamily: 'monospace', marginTop: 4,
    background: 'var(--bg-secondary)', padding: '2px 8px',
    borderRadius: 6,
  },
  qrWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    marginBottom: 16, background: 'var(--bg-secondary)',
    borderRadius: 12, padding: '16px',
  },
  qr: { width: 200, height: 200, borderRadius: 8 },
  qrPlaceholder: {
    width: 200, height: 200, background: 'var(--bg-tertiary)',
    borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-muted)',
  },
  qrHint: {
    fontSize: 11, color: 'var(--text-muted)',
    textAlign: 'center', marginTop: 8, lineHeight: 1.4,
  },
  keySection: { marginBottom: 14 },
  keyLabel: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' },
  keyBox: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'var(--bg-secondary)', borderRadius: 8,
    padding: '8px 10px', border: '1px solid var(--border)',
  },
  keyText: {
    fontFamily: 'monospace', fontSize: 11,
    color: 'var(--text-secondary)', flex: 1,
    wordBreak: 'break-all',
  },
  actions: { marginBottom: 12 },
  shareBtn: { width: '100%', fontWeight: 600 },
  hint: {
    fontSize: 11, color: 'var(--text-muted)',
    background: 'var(--bg-secondary)', padding: '8px 10px',
    borderRadius: 8, lineHeight: 1.5,
  },
}
