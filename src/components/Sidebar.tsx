import { useState, useMemo, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore, Contact, NostrChannel, P2pPeer } from '../store'
import ContactContextMenu from './ContactContextMenu'
import ContactProfile from './ContactProfile'
import IncomingRequestModal from './IncomingRequestModal'
import BearLogo from './BearLogo'
import UserSearchModal from './UserSearchModal'

interface Props {
  onAddContact: (prefill?: { pk?: string; nick?: string }) => void
  onAddChannel?: () => void
  onCreateGroup?: () => void
}

export default function Sidebar({ onAddContact, onAddChannel, onCreateGroup }: Props) {
  const {
    identity, contacts, chats, lanPeers, p2pPeers, activeChat,
    setActiveChat, sidebarSearch, setSidebarSearch,
    myStatus, setMyStatus, setPage, loadContacts, loadChats,
    contactRequests, loadContactRequests, myAvatar,
    channels, activeChannel, setActiveChannel, loadChannels,
  } = useStore()

  const [tab, setTab] = useState<'chats' | 'channels'>('chats')
  const [channelSearch, setChannelSearch] = useState('')
  const [customId, setCustomId] = useState('')
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    contact: Contact; x: number; y: number
  } | null>(null)
  const [profileContact, setProfileContact] = useState<Contact | null>(null)
  const [showRequest, setShowRequest] = useState(false)
  const [channelCtxMenu, setChannelCtxMenu] = useState<{ ch: NostrChannel; x: number; y: number } | null>(null)
  const [showUserSearch, setShowUserSearch] = useState(false)

  useEffect(() => { loadChannels() }, [])
  useEffect(() => {
    invoke<any>('get_settings').then(s => { if (s.custom_id) setCustomId(s.custom_id) }).catch(() => {})
  }, [])
  useEffect(() => {
    const close = () => setChannelCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Показываем первый ожидающий запрос
  const pendingRequest = contactRequests[0] ?? null

  const filtered = useMemo(() => {
    const q = sidebarSearch.toLowerCase()
    if (!q) return contacts
    return contacts.filter(c =>
      (c.local_alias ?? c.nickname).toLowerCase().includes(q) ||
      c.public_key.toLowerCase().includes(q)
    )
  }, [contacts, sidebarSearch])

  const favorites = filtered.filter(c => c.is_favorite)
  const regular   = filtered.filter(c => !c.is_favorite)

  const chatForContact = (pk: string) =>
    chats.find(ch => ch.chat_type === 'direct' && ch.peer_key === pk)

  const openChat = (contact: Contact) => {
    const chat = chatForContact(contact.public_key)
    setActiveChat(chat ?? {
      id: -1,
      chat_type: 'direct',
      peer_key: contact.public_key,
      group_id: null,
      created_at: Date.now() / 1000,
      last_message: null,
      last_message_time: null,
      unread_count: 0,
    })
    setContextMenu(null)
  }

  const displayName = (c: Contact) => c.local_alias ?? c.nickname

  const unreadFor = (pk: string) => chatForContact(pk)?.unread_count ?? 0

  const lastMessageFor = (pk: string) => {
    const ch = chatForContact(pk)
    return ch?.last_message ?? null
  }

  const handleContextMenu = (e: React.MouseEvent, contact: Contact) => {
    e.preventDefault()
    setContextMenu({ contact, x: e.clientX, y: e.clientY })
  }

  const handleToggleFavorite = async (contact: Contact) => {
    await invoke('update_contact', {
      publicKey: contact.public_key,
      alias: contact.local_alias ?? null,
      notes: contact.notes ?? null,
      isFavorite: !contact.is_favorite,
      isBlocked: contact.is_blocked,
    })
    loadContacts()
  }

  const handleDelete = async (contact: Contact) => {
    await invoke('delete_contact', { publicKey: contact.public_key })
    loadContacts()
    loadChats()
  }

  const statuses = [
    { key: 'online',  label: 'Онлайн' },
    { key: 'away',    label: 'Отошёл' },
    { key: 'busy',    label: 'Занят' },
    { key: 'offline', label: 'Невидимка' },
  ]

  return (
    <div style={s.root}>
      {/* ── Шапка ── */}
      <div style={s.header}>
        <div style={s.avatar}>
          {myAvatar
            ? <img src={myAvatar} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
            : <BearLogo size={34} />
          }
        </div>
        <div style={s.headerInfo}>
          <div style={s.myNick}>{identity?.nickname ?? 'Soviet'}</div>
          {customId && (
            <div style={{ ...s.myShortId, color: '#9b59b6' }}>@{customId}</div>
          )}
          <div style={s.statusBadge} onClick={() => setShowStatusMenu(v => !v)}>
            <span className={`status-dot ${myStatus}`} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {{ online:'Онлайн', away:'Отошёл', busy:'Занят', offline:'Невидимка' }[myStatus] ?? myStatus}
              {' ▾'}
            </span>
          </div>
          {showStatusMenu && (
            <div style={s.statusMenu}>
              {statuses.map(st => (
                <div key={st.key} style={s.statusItem}
                  onClick={() => { setMyStatus(st.key); setShowStatusMenu(false) }}>
                  <span className={`status-dot ${st.key}`} />
                  <span>{st.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn-icon" onClick={() => setPage('settings')} title="Настройки">⚙️</button>
      </div>

      {/* ── Уведомление о запросе контакта ── */}
      {pendingRequest && (
        <div style={s.requestBanner} onClick={() => setShowRequest(true)}>
          <span style={{ fontSize: 14 }}>👤</span>
          <span style={{ fontSize: 12, flex: 1 }}>
            <b>{pendingRequest.nickname}</b> хочет добавить вас
          </span>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Открыть</span>
        </div>
      )}

      {/* ── Вкладки Чаты / Каналы ── */}
      <div style={s.tabs}>
        <button className={tab === 'chats' ? 'btn-primary' : 'btn-secondary'}
          style={s.tabBtn} onClick={() => setTab('chats')}>
          💬 Чаты
        </button>
        <button className={tab === 'channels' ? 'btn-primary' : 'btn-secondary'}
          style={s.tabBtn} onClick={() => setTab('channels')}>
          📡 Каналы
          {channels.reduce((n, c) => n + c.unread_count, 0) > 0 && (
            <span style={s.tabBadge}>{channels.reduce((n, c) => n + c.unread_count, 0)}</span>
          )}
        </button>
      </div>

      {tab === 'chats' && (
        <>
          {/* ── Поиск ── */}
          <div style={s.searchWrap}>
            <input
              style={s.search}
              placeholder="🔍  Поиск..."
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
            />
            <button className="btn-icon" title="Найти пользователя по ID"
              style={{ flexShrink: 0, fontSize: 16 }}
              onClick={() => setShowUserSearch(true)}>
              🔎
            </button>
          </div>

          {/* ── Список контактов ── */}
          <div style={s.list}>
            {favorites.length > 0 && (
              <>
                <SectionLabel>★ ИЗБРАННЫЕ</SectionLabel>
                {favorites.map(c => (
                  <ContactRow
                    key={c.public_key}
                    contact={c}
                    active={activeChat?.peer_key === c.public_key}
                    unread={unreadFor(c.public_key)}
                    displayName={displayName(c)}
                    lastMsg={lastMessageFor(c.public_key)}
                    onClick={() => openChat(c)}
                    onContextMenu={e => handleContextMenu(e, c)}
                  />
                ))}
              </>
            )}

            {regular.length > 0 && (
              <>
                <SectionLabel>💬 КОНТАКТЫ</SectionLabel>
                {regular.map(c => (
                  <ContactRow
                    key={c.public_key}
                    contact={c}
                    active={activeChat?.peer_key === c.public_key}
                    unread={unreadFor(c.public_key)}
                    displayName={displayName(c)}
                    lastMsg={lastMessageFor(c.public_key)}
                    onClick={() => openChat(c)}
                    onContextMenu={e => handleContextMenu(e, c)}
                  />
                ))}
              </>
            )}

            {lanPeers.filter(p => !contacts.find(c => c.public_key === p.public_key)).length > 0 && (
              <>
                <SectionLabel>📡 РЯДОМ (LAN)</SectionLabel>
                {lanPeers
                  .filter(p => !contacts.find(c => c.public_key === p.public_key))
                  .map(p => (
                    <LanPeerRow key={p.public_key} peer={p}
                      onAdd={() => onAddContact({ pk: p.public_key, nick: p.nickname })} />
                  ))}
              </>
            )}

            {p2pPeers.filter(p =>
              p.soviet_pk && !contacts.find(c => c.public_key === p.soviet_pk) &&
              !lanPeers.find(l => l.public_key === p.soviet_pk)
            ).length > 0 && (
              <>
                <SectionLabel>🌐 ИНТЕРНЕТ (P2P)</SectionLabel>
                {p2pPeers
                  .filter(p =>
                    p.soviet_pk && !contacts.find(c => c.public_key === p.soviet_pk) &&
                    !lanPeers.find(l => l.public_key === p.soviet_pk)
                  )
                  .map(p => (
                    <P2pPeerRow key={p.peer_id} peer={p}
                      onAdd={() => p.soviet_pk && onAddContact({ pk: p.soviet_pk, nick: p.soviet_pk.slice(0, 8) })} />
                  ))}
              </>
            )}

            {contacts.length === 0 && lanPeers.length === 0 && (
              <div style={s.empty}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Нет контактов.<br />Добавьте первого!
                </div>
              </div>
            )}
          </div>

          {/* ── Кнопки ── */}
          <div style={s.footer}>
            <button className="btn-primary" style={{ ...s.addBtn, flex: 1 }} onClick={() => onAddContact()}>
              + Контакт
            </button>
            <button className="btn-secondary" style={{ ...s.addBtn, flex: 1 }} onClick={() => onCreateGroup?.()}>
              👥 Группа
            </button>
          </div>
        </>
      )}

      {tab === 'channels' && (
        <>
          <div style={s.searchWrap}>
            <input
              style={s.search}
              placeholder="🔍  Поиск каналов..."
              value={channelSearch}
              onChange={e => setChannelSearch(e.target.value)}
            />
          </div>
          <div style={s.list}>
            {channels.length === 0 && (
              <div style={s.empty}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Нет каналов.<br />Создайте или вступите!
                </div>
              </div>
            )}
            {channels
              .filter(ch => !channelSearch || ch.name.toLowerCase().includes(channelSearch.toLowerCase()))
              .map(ch => (
              <div key={ch.channel_id}
                style={{
                  ...sl.row,
                  background: activeChannel?.channel_id === ch.channel_id ? 'var(--bg-tertiary)' : 'transparent'
                }}
                onClick={() => setActiveChannel(ch)}
                onContextMenu={(e) => { e.preventDefault(); setChannelCtxMenu({ ch, x: e.clientX, y: e.clientY }) }}
                onMouseEnter={e => { if (activeChannel?.channel_id !== ch.channel_id) e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = activeChannel?.channel_id === ch.channel_id ? 'var(--bg-tertiary)' : 'transparent' }}
              >
                {ch.picture && ch.picture.startsWith('data:')
                  ? <img src={ch.picture} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ ...sl.avatar, background: 'rgba(128,0,255,0.15)', color: '#9b59b6', fontSize: 15, fontWeight: 700 }}>
                      {ch.name ? ch.name.charAt(0).toUpperCase() : '📢'}
                    </div>
                }
                <div style={sl.info}>
                  <div style={sl.nameRow}>
                    <span style={sl.name}>{ch.name || 'Канал'}</span>
                  </div>
                  <div style={sl.sub}>
                    {ch.about
                      ? (ch.about.length > 60 ? ch.about.slice(0, 60) + '…' : ch.about)
                      : (ch.last_message ?? 'Нет сообщений')}
                  </div>
                </div>
                {ch.unread_count > 0 && (
                  <div style={sl.badge}>{ch.unread_count > 99 ? '99+' : ch.unread_count}</div>
                )}
              </div>
            ))}
          </div>
          <div style={s.footer}>
            <button className="btn-primary" style={s.addBtn} onClick={() => onAddChannel?.()}>
              + Канал
            </button>
          </div>
        </>
      )}

      {channelCtxMenu && (
        <div
          style={{
            position: 'fixed', zIndex: 9999,
            left: channelCtxMenu.x, top: channelCtxMenu.y,
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '4px 0', boxShadow: '0 4px 16px var(--shadow)',
            minWidth: 160,
          }}
          onClick={e => e.stopPropagation()}
        >
          <button style={ctxItemStyle} onClick={() => { setActiveChannel(channelCtxMenu.ch); setChannelCtxMenu(null) }}>
            💬 Открыть
          </button>
          <button style={ctxItemStyle} onClick={async () => {
            if (!confirm(`Покинуть «${channelCtxMenu.ch.name}»?`)) return
            await useStore.getState().leaveChannel(channelCtxMenu.ch.channel_id)
            setChannelCtxMenu(null)
          }}>🚪 Покинуть</button>
        </div>
      )}

      {/* ── Контекстное меню ── */}
      {contextMenu && (
        <ContactContextMenu
          contact={contextMenu.contact}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onOpenChat={() => openChat(contextMenu.contact)}
          onViewProfile={() => { setProfileContact(contextMenu.contact); setContextMenu(null) }}
          onToggleFavorite={() => handleToggleFavorite(contextMenu.contact)}
          onDelete={() => handleDelete(contextMenu.contact)}
        />
      )}

      {/* ── Профиль контакта ── */}
      {profileContact && (
        <ContactProfile
          contact={profileContact}
          onClose={() => setProfileContact(null)}
        />
      )}

      {/* ── Входящий запрос контакта ── */}
      {showRequest && pendingRequest && (
        <IncomingRequestModal
          request={pendingRequest}
          onClose={() => { setShowRequest(false); loadContactRequests() }}
        />
      )}

      {/* ── Поиск пользователей ── */}
      {showUserSearch && (
        <UserSearchModal
          onClose={() => setShowUserSearch(false)}
          onAddContact={(prefill) => { setShowUserSearch(false); onAddContact(prefill) }}
        />
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={sl.label}>{children}</div>
}

function ContactRow({ contact, active, unread, displayName, lastMsg, onClick, onContextMenu }: {
  contact: Contact
  active: boolean
  unread: number
  displayName: string
  lastMsg: string | null
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      style={{ ...sl.row, background: active ? 'var(--bg-tertiary)' : 'transparent' }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--bg-tertiary)' : 'transparent' }}
    >
      <div style={sl.avatar}>
        <span style={{ fontSize: 16 }}>{displayName.charAt(0).toUpperCase()}</span>
        <span className={`status-dot ${contact.status}`} style={sl.statusDot} />
      </div>
      <div style={sl.info}>
        <div style={sl.nameRow}>
          <span style={sl.name}>
            {displayName}
            {contact.verified && <span style={sl.verified} title="Верифицирован">✓</span>}
          </span>
          {contact.last_seen && contact.status === 'offline' && (
            <span style={sl.time}>{formatLastSeen(contact.last_seen)}</span>
          )}
        </div>
        {lastMsg ? (
          <div style={sl.sub}>{truncate(lastMsg, 36)}</div>
        ) : contact.status_text ? (
          <div style={sl.sub}>{contact.status_text}</div>
        ) : null}
      </div>
      {unread > 0 && (
        <div style={sl.badge}>{unread > 99 ? '99+' : unread}</div>
      )}
    </div>
  )
}

function LanPeerRow({ peer, onAdd }: { peer: any; onAdd: () => void }) {
  return (
    <div style={sl.row}>
      <div style={{ ...sl.avatar, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
        <span style={{ fontSize: 16 }}>?</span>
        <span className="status-dot online" style={sl.statusDot} />
      </div>
      <div style={sl.info}>
        <div style={sl.name}>{peer.nickname}</div>
        <div style={sl.sub}>{peer.addr}</div>
      </div>
      <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={onAdd}>
        + Добавить
      </button>
    </div>
  )
}

function P2pPeerRow({ peer, onAdd }: { peer: P2pPeer; onAdd: () => void }) {
  const shortId = peer.soviet_pk
    ? peer.soviet_pk.slice(0, 12) + '…'
    : peer.peer_id.slice(0, 12) + '…'
  return (
    <div style={sl.row}>
      <div style={{ ...sl.avatar, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
        <span style={{ fontSize: 14 }}>🌐</span>
        <span className="status-dot online" style={sl.statusDot} />
      </div>
      <div style={sl.info}>
        <div style={sl.name}>{shortId}</div>
        <div style={sl.sub}>{peer.addrs[0] ?? 'P2P'}</div>
      </div>
      <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={onAdd}>
        + Добавить
      </button>
    </div>
  )
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function formatLastSeen(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`
  return `${Math.floor(diff / 86400)} д`
}

const ctxItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 14px', background: 'none', border: 'none',
  cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: 230, minWidth: 190, maxWidth: 290,
    display: 'flex', flexDirection: 'column',
    background: 'var(--bg-secondary)',
    borderRight: '1px solid var(--border)',
    height: '100vh', overflow: 'hidden', flexShrink: 0,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 10px', borderBottom: '1px solid var(--border)',
    flexShrink: 0, position: 'relative',
  },
  avatar: {
    width: 36, height: 36, borderRadius: '50%',
    background: 'var(--accent)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: 20, flexShrink: 0,
  },
  headerInfo: { flex: 1, minWidth: 0, position: 'relative' },
  myNick: {
    fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  myShortId: {
    fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace',
    marginTop: 1,
  },
  statusBadge: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 },
  statusMenu: {
    position: 'absolute', top: '100%', left: 0, zIndex: 100,
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
    borderRadius: 10, boxShadow: '0 4px 16px var(--shadow)',
    padding: '4px', minWidth: 130,
  },
  statusItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
    fontSize: 13, color: 'var(--text-primary)',
  },
  requestBanner: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 10px', flexShrink: 0,
    background: 'rgba(204,51,51,0.08)',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
  },
  searchWrap: { padding: '6px 8px 4px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 },
  search: { flex: 1, minWidth: 0, padding: '5px 10px', fontSize: 13, borderRadius: 8 },
  list: { flex: 1, overflowY: 'auto', padding: '4px 0' },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '40px 16px',
  },
  footer: { padding: '8px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 6 },
  addBtn: { fontSize: 12, padding: '8px 6px' },
}

const sl: Record<string, React.CSSProperties> = {
  label: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
    color: 'var(--text-muted)', padding: '8px 12px 3px',
    textTransform: 'uppercase',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 10px', cursor: 'pointer',
    transition: 'background 0.1s', borderRadius: 6, margin: '1px 4px',
  },
  avatar: {
    width: 34, height: 34, borderRadius: '50%',
    background: 'var(--accent)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    color: 'white', fontWeight: 700, fontSize: 14,
    position: 'relative', flexShrink: 0,
  },
  statusDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 10, height: 10, border: '2px solid var(--bg-secondary)', borderRadius: '50%',
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: {
    display: 'flex', alignItems: 'baseline', gap: 4,
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0,
  },
  verified: { color: 'var(--online)', fontSize: 11 },
  time: { fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 },
  sub: {
    fontSize: 11, color: 'var(--text-muted)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    marginTop: 1,
  },
  badge: {
    background: 'var(--accent)', color: 'white',
    borderRadius: 10, padding: '2px 6px', fontSize: 11, fontWeight: 700,
    flexShrink: 0,
  },
}
