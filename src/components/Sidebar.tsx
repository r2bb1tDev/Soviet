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
    const close = () => { setChannelCtxMenu(null); setShowStatusMenu(false) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

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
  const unreadFor   = (pk: string) => chatForContact(pk)?.unread_count ?? 0
  const lastMsgFor  = (pk: string) => chatForContact(pk)?.last_message ?? null
  const lastTimeFor = (pk: string) => chatForContact(pk)?.last_message_time ?? null

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

  const totalChannelUnread = channels.reduce((n, c) => n + c.unread_count, 0)

  return (
    <div style={s.root}>
      {/* ── Header ── */}
      <div style={s.header}>
        <div style={s.headerAvatar} className="avatar-wrap">
          {myAvatar
            ? <img src={myAvatar} style={s.avatarImg} />
            : <BearLogo size={36} />
          }
        </div>
        <div style={s.headerInfo}>
          <div style={s.myNick} className="truncate">{identity?.nickname ?? 'Soviet'}</div>
          {customId && <div style={s.myId}>@{customId}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="btn-icon" title="Поиск" style={s.headerBtn}
            onClick={() => setShowUserSearch(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          <button className="btn-icon" title="Настройки" style={s.headerBtn}
            onClick={() => setPage('settings')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Contact request banner ── */}
      {pendingRequest && (
        <div style={s.requestBanner} onClick={() => setShowRequest(true)}>
          <div style={s.requestDot} />
          <span style={{ fontSize: 12, flex: 1 }}>
            <b>{pendingRequest.nickname}</b> хочет добавить вас
          </span>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Открыть</span>
        </div>
      )}

      {/* ── Search bar ── */}
      <div style={s.searchWrap}>
        <div style={s.searchInner}>
          <svg style={s.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            style={s.search}
            placeholder="Поиск"
            value={tab === 'chats' ? sidebarSearch : channelSearch}
            onChange={e => tab === 'chats' ? setSidebarSearch(e.target.value) : setChannelSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={s.tabs}>
        <button style={{ ...s.tabBtn, ...(tab === 'chats' ? s.tabActive : {}) }}
          onClick={() => setTab('chats')}>
          Чаты
        </button>
        <button style={{ ...s.tabBtn, ...(tab === 'channels' ? s.tabActive : {}), position: 'relative' }}
          onClick={() => setTab('channels')}>
          Каналы
          {totalChannelUnread > 0 && (
            <span className="unread-badge" style={{ position: 'absolute', top: 2, right: 4, fontSize: 10, minWidth: 16, height: 16 }}>
              {totalChannelUnread > 99 ? '99+' : totalChannelUnread}
            </span>
          )}
        </button>
      </div>

      {/* ── List ── */}
      <div style={s.list}>
        {tab === 'chats' && (
          <>
            {favorites.length > 0 && (
              <>
                <SectionLabel>Избранные</SectionLabel>
                {favorites.map(c => (
                  <ContactRow
                    key={c.public_key}
                    contact={c}
                    active={activeChat?.peer_key === c.public_key}
                    unread={unreadFor(c.public_key)}
                    displayName={displayName(c)}
                    lastMsg={lastMsgFor(c.public_key)}
                    lastTime={lastTimeFor(c.public_key)}
                    onClick={() => openChat(c)}
                    onContextMenu={e => handleContextMenu(e, c)}
                  />
                ))}
              </>
            )}

            {regular.length > 0 && (
              <>
                {favorites.length > 0 && <SectionLabel>Контакты</SectionLabel>}
                {regular.map(c => (
                  <ContactRow
                    key={c.public_key}
                    contact={c}
                    active={activeChat?.peer_key === c.public_key}
                    unread={unreadFor(c.public_key)}
                    displayName={displayName(c)}
                    lastMsg={lastMsgFor(c.public_key)}
                    lastTime={lastTimeFor(c.public_key)}
                    onClick={() => openChat(c)}
                    onContextMenu={e => handleContextMenu(e, c)}
                  />
                ))}
              </>
            )}

            {lanPeers.filter(p => !contacts.find(c => c.public_key === p.public_key)).length > 0 && (
              <>
                <SectionLabel>Рядом (LAN)</SectionLabel>
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
                <SectionLabel>Интернет (P2P)</SectionLabel>
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
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 12 }}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                  Нет контактов.<br />Добавьте первого!
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'channels' && (
          <>
            {channels.length === 0 && (
              <div style={s.empty}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 12 }}>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                  Нет каналов.<br />Создайте или вступите!
                </div>
              </div>
            )}
            {channels
              .filter(ch => !channelSearch || ch.name.toLowerCase().includes(channelSearch.toLowerCase()))
              .map(ch => (
                <ChannelRow
                  key={ch.channel_id}
                  ch={ch}
                  active={activeChannel?.channel_id === ch.channel_id}
                  onClick={() => setActiveChannel(ch)}
                  onContextMenu={e => { e.preventDefault(); setChannelCtxMenu({ ch, x: e.clientX, y: e.clientY }) }}
                />
              ))}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={s.footer}>
        {tab === 'chats' ? (
          <>
            <button className="btn-primary" style={s.footerBtn} onClick={() => onAddContact()}>
              + Контакт
            </button>
            <button className="btn-secondary" style={s.footerBtn} onClick={() => onCreateGroup?.()}>
              + Группа
            </button>
          </>
        ) : (
          <button className="btn-primary" style={{ ...s.footerBtn, flex: 1 }} onClick={() => onAddChannel?.()}>
            + Канал
          </button>
        )}
      </div>

      {/* ── Channel context menu ── */}
      {channelCtxMenu && (
        <div
          style={s.ctxMenu}
          onClick={e => e.stopPropagation()}
        >
          <button style={s.ctxItem} onClick={() => { setActiveChannel(channelCtxMenu.ch); setChannelCtxMenu(null) }}>
            Открыть
          </button>
          <button style={s.ctxItem} onClick={async () => {
            if (!confirm(`Покинуть «${channelCtxMenu.ch.name}»?`)) return
            await useStore.getState().leaveChannel(channelCtxMenu.ch.channel_id)
            setChannelCtxMenu(null)
          }}>
            Покинуть
          </button>
        </div>
      )}

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

      {profileContact && (
        <ContactProfile
          contact={profileContact}
          onClose={() => setProfileContact(null)}
        />
      )}

      {showRequest && pendingRequest && (
        <IncomingRequestModal
          request={pendingRequest}
          onClose={() => { setShowRequest(false); loadContactRequests() }}
        />
      )}

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
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
      color: 'var(--text-muted)', padding: '10px 16px 4px',
      textTransform: 'uppercase',
    }}>
      {children}
    </div>
  )
}

function ContactRow({ contact, active, unread, displayName, lastMsg, lastTime, onClick, onContextMenu }: {
  contact: Contact
  active: boolean
  unread: number
  displayName: string
  lastMsg: string | null
  lastTime: number | null
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const initials = displayName.charAt(0).toUpperCase()
  const avatarColor = stringToColor(contact.public_key)

  return (
    <div
      style={{
        ...row.wrap,
        background: active ? 'var(--row-active-bg)' : 'transparent',
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--row-active-bg)' : 'transparent' }}
    >
      <div style={{ ...row.avatar, background: avatarColor }}>
        {initials}
        <span className={`status-dot ${contact.status}`} style={row.statusDot} />
      </div>
      <div style={row.info}>
        <div style={row.top}>
          <span style={row.name} className="truncate">
            {displayName}
            {contact.verified && (
              <svg style={{ marginLeft: 3, color: 'var(--accent)', flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
              </svg>
            )}
          </span>
          {lastTime && (
            <span style={row.time}>{formatTime(lastTime)}</span>
          )}
        </div>
        <div style={row.bottom}>
          <span style={row.sub} className="truncate">
            {lastMsg ?? contact.status_text ?? ''}
          </span>
          {unread > 0 && (
            <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function ChannelRow({ ch, active, onClick, onContextMenu }: {
  ch: NostrChannel
  active: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const initials = ch.name ? ch.name.charAt(0).toUpperCase() : '#'
  return (
    <div
      style={{
        ...row.wrap,
        background: active ? 'var(--row-active-bg)' : 'transparent',
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--row-active-bg)' : 'transparent' }}
    >
      {ch.picture && ch.picture.startsWith('data:')
        ? <img src={ch.picture} style={{ ...row.avatar, objectFit: 'cover' } as React.CSSProperties} />
        : <div style={{ ...row.avatar, background: '#7B68EE', color: '#fff', fontSize: 16, fontWeight: 700 }}>
            {initials}
          </div>
      }
      <div style={row.info}>
        <div style={row.top}>
          <span style={row.name} className="truncate">{ch.name || 'Канал'}</span>
        </div>
        <div style={row.bottom}>
          <span style={row.sub} className="truncate">
            {ch.about
              ? (ch.about.length > 55 ? ch.about.slice(0, 55) + '…' : ch.about)
              : (ch.last_message ?? 'Нет сообщений')}
          </span>
          {ch.unread_count > 0 && (
            <span className="unread-badge">{ch.unread_count > 99 ? '99+' : ch.unread_count}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function LanPeerRow({ peer, onAdd }: { peer: any; onAdd: () => void }) {
  return (
    <div style={row.wrap}>
      <div style={{ ...row.avatar, background: 'var(--bg-tertiary)', color: 'var(--text-muted)', fontSize: 16 }}>
        ?
        <span className="status-dot online" style={row.statusDot} />
      </div>
      <div style={row.info}>
        <div style={row.top}>
          <span style={row.name} className="truncate">{peer.nickname}</span>
        </div>
        <div style={row.bottom}>
          <span style={row.sub} className="truncate">{peer.addr}</span>
          <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6 }} onClick={onAdd}>
            + Добавить
          </button>
        </div>
      </div>
    </div>
  )
}

function P2pPeerRow({ peer, onAdd }: { peer: P2pPeer; onAdd: () => void }) {
  const shortId = peer.soviet_pk
    ? peer.soviet_pk.slice(0, 12) + '…'
    : peer.peer_id.slice(0, 12) + '…'
  return (
    <div style={row.wrap}>
      <div style={{ ...row.avatar, background: 'var(--bg-tertiary)', color: 'var(--text-muted)', fontSize: 14 }}>
        P2P
        <span className="status-dot online" style={row.statusDot} />
      </div>
      <div style={row.info}>
        <div style={row.top}>
          <span style={row.name} className="truncate">{shortId}</span>
        </div>
        <div style={row.bottom}>
          <span style={row.sub} className="truncate">{peer.addrs[0] ?? 'P2P'}</span>
          <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6 }} onClick={onAdd}>
            + Добавить
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) {
    return d.toLocaleDateString('ru', { weekday: 'short' })
  }
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

function stringToColor(str: string): string {
  const palette = [
    '#FF6B6B', '#FF8E53', '#FFD93D', '#6BCB77',
    '#2AABEE', '#845EC2', '#FF9671', '#F9F871',
    '#00C9A7', '#C34B4B', '#4D8B31', '#3D5A80',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return palette[Math.abs(hash) % palette.length]
}

/* ── Styles ── */
const s: Record<string, React.CSSProperties> = {
  root: {
    width: 320, minWidth: 260, maxWidth: 360,
    display: 'flex', flexDirection: 'column',
    background: 'var(--bg-sidebar)',
    borderRight: '1px solid var(--divider)',
    height: '100vh', overflow: 'hidden', flexShrink: 0,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px',
    background: 'var(--header-bg)',
    borderBottom: '1px solid var(--divider)',
    flexShrink: 0,
  },
  headerAvatar: {
    width: 40, height: 40, borderRadius: '50%',
    overflow: 'hidden', flexShrink: 0, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--accent)',
  },
  avatarImg: { width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' },
  headerInfo: { flex: 1, minWidth: 0 },
  myNick: {
    fontSize: 15, fontWeight: 700,
    color: 'var(--header-text)',
    maxWidth: '100%',
  },
  myId: { fontSize: 12, color: 'var(--text-muted)', marginTop: 1 },
  headerBtn: { width: 34, height: 34 },
  requestBanner: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 14px', flexShrink: 0,
    background: 'rgba(42,171,238,0.10)',
    borderBottom: '1px solid var(--divider)',
    cursor: 'pointer',
  },
  requestDot: {
    width: 8, height: 8, borderRadius: '50%',
    background: 'var(--accent)', flexShrink: 0,
  },
  searchWrap: {
    padding: '8px 12px 6px',
    flexShrink: 0,
    background: 'var(--bg-sidebar)',
  },
  searchInner: {
    display: 'flex', alignItems: 'center',
    background: 'var(--bg-secondary)',
    borderRadius: 20,
    padding: '6px 12px',
    gap: 8,
  },
  searchIcon: { color: 'var(--text-muted)', flexShrink: 0 },
  search: {
    flex: 1, background: 'transparent', border: 'none',
    outline: 'none', fontSize: 14, color: 'var(--text-primary)',
    padding: 0,
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--divider)',
    flexShrink: 0,
  },
  tabBtn: {
    flex: 1, background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent',
    padding: '8px 0', fontSize: 13, fontWeight: 500,
    color: 'var(--text-secondary)', cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
    position: 'relative',
  },
  tabActive: {
    color: 'var(--accent)',
    borderBottomColor: 'var(--accent)',
  },
  list: { flex: 1, overflowY: 'auto', padding: '4px 0' },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '48px 20px',
  },
  footer: {
    padding: '8px 12px',
    borderTop: '1px solid var(--divider)',
    flexShrink: 0,
    display: 'flex', gap: 8,
  },
  footerBtn: { flex: 1, fontSize: 13, padding: '8px 10px' },
  ctxMenu: {
    position: 'fixed', zIndex: 9999,
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 10, padding: '4px 0',
    boxShadow: '0 4px 20px var(--shadow-md)',
    minWidth: 160,
  },
  ctxItem: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '9px 16px', background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
  },
}

const row: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', cursor: 'pointer',
    transition: 'background 0.1s',
  },
  avatar: {
    width: 46, height: 46, borderRadius: '50%',
    background: 'var(--accent)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: 18,
    position: 'relative', flexShrink: 0,
    userSelect: 'none',
  },
  statusDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 11, height: 11,
    border: '2px solid var(--bg-sidebar)',
    borderRadius: '50%',
  },
  info: { flex: 1, minWidth: 0 },
  top: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 6,
    marginBottom: 2,
  },
  name: {
    fontSize: 14, fontWeight: 600,
    color: 'var(--text-primary)',
    flex: 1, minWidth: 0,
    display: 'flex', alignItems: 'center', gap: 2,
  },
  time: {
    fontSize: 11, color: 'var(--text-muted)',
    flexShrink: 0, whiteSpace: 'nowrap',
  },
  bottom: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 6,
  },
  sub: {
    fontSize: 13, color: 'var(--text-secondary)',
    flex: 1, minWidth: 0,
  },
}
