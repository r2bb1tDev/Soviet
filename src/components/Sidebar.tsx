import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore, Contact, P2pPeer, SearchResult } from '../store'
import ContactContextMenu from './ContactContextMenu'
import ContactProfile from './ContactProfile'
import IncomingRequestModal from './IncomingRequestModal'
import BearLogo from './BearLogo'
import UserSearchModal from './UserSearchModal'
import FileTransferWindow from './FileTransferWindow'

interface Props {
  onAddContact: (prefill?: { pk?: string; nick?: string }) => void
  onCreateGroup?: () => void
}

export default function Sidebar({ onAddContact, onCreateGroup }: Props) {
  const {
    identity, contacts, chats, lanPeers, p2pPeers, activeChat,
    openTab, sidebarSearch, setSidebarSearch,
    setPage, loadContacts, loadChats,
    contactRequests, loadContactRequests, myAvatar,
    myStatus, setMyStatus,
    searchResults, searchMessages, clearSearch,
  } = useStore()

  const [customId, setCustomId] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    contact: Contact; x: number; y: number
  } | null>(null)
  const [profileContact, setProfileContact] = useState<Contact | null>(null)
  const [showRequest, setShowRequest] = useState(false)
  const [groupCtxMenu, setGroupCtxMenu] = useState<{ chat: typeof chats[0]; x: number; y: number } | null>(null)
  const [showUserSearch, setShowUserSearch] = useState(false)
  const [showTransfers, setShowTransfers] = useState(false)
  const [showStatusPanel, setShowStatusPanel] = useState(false)
  const [customStatusText, setCustomStatusText] = useState('')
  const statusPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    invoke<any>('get_settings').then(s => { if (s.custom_id) setCustomId(s.custom_id) }).catch(() => {})
  }, [])

  // Поиск по истории сообщений с дебаунсом 300 мс
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Ctrl+F — глобальный фокус поиска
  useEffect(() => {
    const handler = () => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('soviet:focus-search', handler)
    return () => window.removeEventListener('soviet:focus-search', handler)
  }, [])

  // Ctrl+N — открыть поиск нового контакта
  useEffect(() => {
    const handler = () => setShowUserSearch(true)
    window.addEventListener('soviet:new-chat', handler)
    return () => window.removeEventListener('soviet:new-chat', handler)
  }, [])

  // Escape — закрыть модалки
  useEffect(() => {
    const handler = () => {
      setShowUserSearch(false)
      setShowRequest(false)
      setGroupCtxMenu(null)
    }
    window.addEventListener('soviet:escape', handler)
    return () => window.removeEventListener('soviet:escape', handler)
  }, [])
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (sidebarSearch.trim().length < 2) { clearSearch(); return }
    searchTimer.current = setTimeout(() => searchMessages(sidebarSearch.trim()), 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [sidebarSearch])
  useEffect(() => {
    const close = () => { setGroupCtxMenu(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Закрыть панель статуса при клике снаружи
  useEffect(() => {
    if (!showStatusPanel) return
    const handler = (e: MouseEvent) => {
      if (statusPanelRef.current && !statusPanelRef.current.contains(e.target as Node)) {
        setShowStatusPanel(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showStatusPanel])

  const pendingRequest = contactRequests[0] ?? null

  const filtered = useMemo(() => {
    const q = sidebarSearch.trim()
    if (!q) return contacts
    const isAtQuery = q.startsWith('@')
    const isHexQuery = /^[0-9a-fA-F]{32,}$/.test(q)
    const qLow = q.toLowerCase()
    const qId = isAtQuery ? q.slice(1).toLowerCase() : ''
    return contacts.filter(c => {
      if (isAtQuery) {
        const cid = (c as any).custom_id ?? ''
        return cid.toLowerCase().includes(qId)
      }
      if (isHexQuery) {
        return c.public_key.toLowerCase().startsWith(qLow)
      }
      return (
        c.nickname.toLowerCase().includes(qLow) ||
        c.public_key.toLowerCase().includes(qLow) ||
        (c.local_alias ?? '').toLowerCase().includes(qLow) ||
        ((c as any).custom_id ?? '').toLowerCase().includes(qLow)
      )
    })
  }, [contacts, sidebarSearch])

  const favorites = filtered.filter(c => c.is_favorite)
  const regular   = filtered.filter(c => !c.is_favorite)

  // ── Folder collapse state persisted in localStorage ──────────────────────────
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('sidebar_folders_collapsed')
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch { /* ignore */ }
    return new Set()
  })

  const toggleFolder = useCallback((folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      try { localStorage.setItem('sidebar_folders_collapsed', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  // Distinct folder names from non-favorite contacts (alphabetical)
  const folderNames = useMemo(() => {
    const names = new Set<string>()
    regular.forEach(c => { if (c.local_folder) names.add(c.local_folder) })
    return [...names].sort()
  }, [regular])

  const hasAnyFolder = folderNames.length > 0

  // Групповые чаты
  const groupChats = chats.filter(c => c.chat_type === 'group')

  const openGroupChat = (chat: typeof chats[0]) => {
    openTab(chat)
  }

  const chatForContact = (pk: string) =>
    chats.find(ch => ch.chat_type === 'direct' && ch.peer_key === pk)

  const openChat = (contact: Contact) => {
    const chat = chatForContact(contact.public_key)
    openTab(chat ?? {
      id: -1,
      chat_type: 'direct',
      peer_key: contact.public_key,
      group_id: null,
      created_at: Date.now() / 1000,
      last_message: null,
      last_message_time: null,
      unread_count: 0,
      group_name: null,
    })
    setContextMenu(null)
  }

  const displayName = (c: Contact) => c.nickname
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

  return (
    <div style={s.root}>
      {/* ── Header ── */}
      <div style={s.header}>
        <div
          style={s.headerAvatar}
          className="avatar-wrap"
        >
          {myAvatar
            ? <img src={myAvatar} style={s.avatarImg} />
            : <BearLogo size={36} />
          }
        </div>
        <div style={s.headerInfo}>
          <div style={s.myNick} className="truncate">{identity?.nickname ?? 'Soviet'}</div>
          <div style={s.myId}>{customId ? `@${customId}` : <span style={{opacity:0.5, fontSize:11}}>нет ID</span>}</div>
        </div>
        {/* Status dropdown */}
        <div style={{ position: 'relative' }} ref={statusPanelRef}>
          <button
            title="Статус"
            style={{
              ...s.statusSelect,
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 8, cursor: 'pointer', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
              fontSize: 12,
            }}
            onClick={e => { e.stopPropagation(); setShowStatusPanel(v => !v) }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: myStatus === 'online' ? 'var(--online)'
                : myStatus === 'away' ? 'var(--away)'
                : myStatus === 'dnd' ? 'var(--busy)'
                : myStatus === 'invisible' ? 'var(--text-muted)'
                : 'var(--offline)',
            }} />
            {myStatus === 'online' ? 'В сети'
              : myStatus === 'away' ? 'Отошёл'
              : myStatus === 'dnd' ? 'Не беспокоить'
              : myStatus === 'na' ? 'Недоступен'
              : myStatus === 'invisible' ? 'Невидимка'
              : myStatus}
          </button>

          {showStatusPanel && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 500,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
              width: 220, padding: '8px 0',
            }} onClick={e => e.stopPropagation()}>
              {/* Базовые статусы */}
              {([
                ['online', 'В сети', 'var(--online)'],
                ['away', 'Отошёл', 'var(--away)'],
                ['dnd', 'Не беспокоить', 'var(--busy)'],
                ['na', 'Недоступен', 'var(--offline)'],
                ['invisible', 'Невидимка', 'var(--text-muted)'],
              ] as [string, string, string][]).map(([val, label, color]) => (
                <button key={val} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '7px 14px', background: myStatus === val ? 'rgba(0,255,65,0.08)' : 'none',
                  border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 13,
                  textAlign: 'left',
                }} onClick={() => { setMyStatus(val, ''); setShowStatusPanel(false) }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  {label}
                </button>
              ))}
              {/* Готовые сообщения */}
              <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 14px 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Готовые сообщения
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 10px 8px' }}>
                {['На работе', 'Обедаю', 'Занят', 'В отпуске', 'На созвоне', 'Кодю'].map(preset => (
                  <button key={preset} style={{
                    fontSize: 11, padding: '3px 8px',
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)',
                  }} onClick={() => { setMyStatus('dnd', preset); setShowStatusPanel(false) }}>
                    {preset}
                  </button>
                ))}
              </div>
              {/* Свой статус */}
              <div style={{ height: 1, background: 'var(--border)', marginBottom: 6 }} />
              <div style={{ padding: '0 10px 8px', display: 'flex', gap: 6 }}>
                <input
                  style={{
                    flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '4px 8px', fontSize: 12, color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                  placeholder="Свой статус..."
                  value={customStatusText}
                  onChange={e => setCustomStatusText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { setMyStatus(myStatus, customStatusText); setShowStatusPanel(false); setCustomStatusText('') }
                  }}
                />
                <button className="btn-primary" style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0 }}
                  onClick={() => { setMyStatus(myStatus, customStatusText); setShowStatusPanel(false); setCustomStatusText('') }}>
                  OK
                </button>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* + Добавить в друзья */}
          <button className="btn-icon" title="Добавить контакт" style={s.headerBtn}
            onClick={() => onAddContact()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          {/* Настройки */}
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

      {/* ── Search bar + File transfer ── */}
      <div style={s.searchWrap}>
        <div style={s.searchInner}>
          <svg style={s.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={searchInputRef}
            style={s.search}
            placeholder="Поиск"
            value={sidebarSearch}
            onChange={e => setSidebarSearch(e.target.value)}
          />
          <button
            className="btn-icon"
            title="Передача файлов"
            style={{ width: 24, height: 24, padding: 0, flexShrink: 0, color: 'var(--text-muted)' }}
            onClick={() => setShowTransfers(true)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── List ── */}
      <div style={s.list}>
        {(
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
                    searchQuery={sidebarSearch}
                  />
                ))}
              </>
            )}

            {regular.length > 0 && !hasAnyFolder && (
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
                    searchQuery={sidebarSearch}
                  />
                ))}
              </>
            )}

            {regular.length > 0 && hasAnyFolder && (
              <>
                {/* Named folders */}
                {folderNames.map(folder => {
                  const folderContacts = regular.filter(c => c.local_folder === folder)
                  if (folderContacts.length === 0) return null
                  const collapsed = collapsedFolders.has(folder)
                  return (
                    <div key={folder}>
                      <CollapsibleSectionLabel
                        collapsed={collapsed}
                        onToggle={() => toggleFolder(folder)}
                      >
                        {folder}
                      </CollapsibleSectionLabel>
                      {!collapsed && folderContacts.map(c => (
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
                          searchQuery={sidebarSearch}
                        />
                      ))}
                    </div>
                  )
                })}

                {/* Unassigned contacts under "Все контакты" */}
                {(() => {
                  const unassigned = regular.filter(c => !c.local_folder)
                  if (unassigned.length === 0) return null
                  const collapsed = collapsedFolders.has('__unassigned__')
                  return (
                    <div>
                      <CollapsibleSectionLabel
                        collapsed={collapsed}
                        onToggle={() => toggleFolder('__unassigned__')}
                      >
                        Все контакты
                      </CollapsibleSectionLabel>
                      {!collapsed && unassigned.map(c => (
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
                          searchQuery={sidebarSearch}
                        />
                      ))}
                    </div>
                  )
                })()}
              </>
            )}

            {groupChats.length > 0 && (
              <>
                <SectionLabel>Группы</SectionLabel>
                {groupChats.map(chat => {
                  const unread = chat.unread_count ?? 0
                  const name = chat.group_name ?? `Группа`
                  return (
                    <div
                      key={chat.id}
                      style={{
                        ...row.wrap,
                        background: activeChat?.id === chat.id ? 'var(--row-active-bg)' : 'transparent',
                      }}
                      onClick={() => openGroupChat(chat)}
                      onContextMenu={e => { e.preventDefault(); setGroupCtxMenu({ chat, x: e.clientX, y: e.clientY }) }}
                      onMouseEnter={e => { if (activeChat?.id !== chat.id) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = activeChat?.id === chat.id ? 'var(--row-active-bg)' : 'transparent' }}
                    >
                      <div style={{ ...row.avatar, background: '#7B68EE', color: '#fff', fontSize: 16, fontWeight: 700 }}>
                        👥
                      </div>
                      <div style={row.info}>
                        <div style={row.top}>
                          <span style={row.name} className="truncate">{name}</span>
                          {chat.last_message_time && <span style={row.time}>{formatTime(chat.last_message_time)}</span>}
                        </div>
                        <div style={row.bottom}>
                          <span style={row.sub} className="truncate">{chat.last_message ?? 'Нет сообщений'}</span>
                          {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
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

            {/* ── Результаты поиска по истории сообщений ── */}
            {sidebarSearch.trim().length >= 2 && (
              <>
                <SectionLabel>
                  {searchResults.length > 0
                    ? `Сообщения (${searchResults.length})`
                    : 'Сообщения'}
                </SectionLabel>
                {searchResults.length === 0 && (
                  <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                    Ничего не найдено
                  </div>
                )}
                {searchResults.map(r => (
                  <MsgSearchRow
                    key={r.msg_id}
                    result={r}
                    contacts={contacts}
                    chats={chats}
                    myPk={identity?.public_key ?? ''}
                    onClick={() => {
                      const chat = chats.find(c => c.id === r.chat_id)
                      if (chat) openTab(chat)
                      clearSearch()
                      setSidebarSearch('')
                    }}
                  />
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

      </div>

      {/* ── Footer ── */}
      <div style={s.footer}>
        <button className="btn-primary" style={s.footerBtn} onClick={() => onAddContact()}>
          + Контакт
        </button>
        <button className="btn-secondary" style={s.footerBtn} onClick={() => onCreateGroup?.()}>
          + Группа
        </button>
      </div>

      {/* ── Bottom status bar (Connection) ── */}
      <div style={s.bottomBar}>
        <span style={s.bottomItem} title={`LAN: ${lanPeers.length} соседей`}>
          <span style={{ ...s.dot, background: lanPeers.length > 0 ? 'var(--online)' : 'var(--offline)' }} />
          LAN
        </span>
        <span style={s.bottomSep}>·</span>
        <span style={s.bottomItem} title={`P2P mesh: ${p2pPeers.length} пиров`}>
          <span style={{ ...s.dot, background: p2pPeers.length > 0 ? 'var(--online)' : 'var(--away)' }} />
          P2P{p2pPeers.length > 0 ? ` ${p2pPeers.length}` : ''}
        </span>
        <span style={s.bottomSep}>·</span>
        <span style={s.bottomItem} title="Nostr relay активен">
          <span style={{ ...s.dot, background: 'var(--online)' }} />
          Nostr
        </span>
        {pendingRequest && (
          <>
            <span style={s.bottomSep}>·</span>
            <span style={{ ...s.bottomItem, color: 'var(--away)', fontWeight: 600 }}>
              1 запрос
            </span>
          </>
        )}
      </div>

      {groupCtxMenu && (
        <div
          style={{ ...s.ctxMenu, left: Math.min(groupCtxMenu.x, window.innerWidth - 200), top: Math.min(groupCtxMenu.y, window.innerHeight - 100) }}
          onClick={e => e.stopPropagation()}
        >
          <button style={s.ctxItem} onClick={() => { openGroupChat(groupCtxMenu.chat); setGroupCtxMenu(null) }}>
            💬 Открыть
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

      {showTransfers && (
        <FileTransferWindow onClose={() => setShowTransfers(false)} />
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

function CollapsibleSectionLabel({ children, collapsed, onToggle }: {
  children: React.ReactNode
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div
      style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
        color: 'var(--text-muted)', padding: '10px 16px 4px',
        textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 5,
        cursor: 'pointer', userSelect: 'none',
        borderBottom: collapsed ? '1px solid var(--border)' : 'none',
      }}
      onClick={onToggle}
    >
      <span style={{ fontSize: 10, flexShrink: 0 }}>{collapsed ? '▸' : '▾'}</span>
      <span>{children}</span>
    </div>
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const q = query.startsWith('@') ? query.slice(1) : query
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return text
  return <>{text.slice(0, idx)}<mark style={{ background: 'var(--accent)', color: 'var(--accent-text)', borderRadius: 2, padding: '0 1px' }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>
}

function ContactRow({ contact, active, unread, displayName, lastMsg, lastTime, onClick, onContextMenu, searchQuery }: {
  contact: Contact
  active: boolean
  unread: number
  displayName: string
  lastMsg: string | null
  lastTime: number | null
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  searchQuery?: string
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
      <div style={{ ...row.avatar, background: contact.avatar_data ? 'transparent' : avatarColor }}>
        {contact.avatar_data
          ? <img src={contact.avatar_data} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          : initials
        }
        <span className={`status-dot ${contact.status}`} style={row.statusDot} />
      </div>
      <div style={row.info}>
        <div style={row.top}>
          <span style={row.name} className="truncate">
            {highlightMatch(displayName, searchQuery ?? '')}
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

function MsgSearchRow({
  result, contacts, chats, myPk, onClick,
}: {
  result: SearchResult
  contacts: Contact[]
  chats: any[]
  myPk: string
  onClick: () => void
}) {
  // Определяем имя чата
  let chatName = 'Чат'
  if (result.chat_type === 'direct' && result.peer_key) {
    const c = contacts.find(c => c.public_key === result.peer_key)
    chatName = c?.local_alias || c?.nickname || result.peer_key.slice(0, 10) + '…'
  } else if (result.chat_type === 'group' && result.group_id) {
    const ch = chats.find(c => c.group_id === result.group_id)
    chatName = ch?.group_id?.slice(0, 12) + '…' || 'Группа'
  }
  const isMe = result.sender_key === myPk
  const preview = result.content_type === 'file' ? '📎 ' + result.plaintext : result.plaintext
  const ts = formatTime(result.timestamp)

  return (
    <div style={{ ...row.wrap, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ ...row.avatar, fontSize: 14, background: 'var(--bg-tertiary)', color: 'var(--accent)' }}>
        🔍
      </div>
      <div style={row.info}>
        <div style={row.top}>
          <span style={row.name} className="truncate">{chatName}</span>
          <span style={row.time}>{ts}</span>
        </div>
        <div style={row.bottom}>
          <span style={{ ...row.sub, fontStyle: 'italic' }} className="truncate">
            {isMe ? 'Вы: ' : ''}{preview.slice(0, 60)}{preview.length > 60 ? '…' : ''}
          </span>
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
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px',
    background: 'var(--header-bg)',
    borderBottom: '1px solid var(--divider)',
    flexShrink: 0,
    minHeight: 56,
  },
  headerAvatar: {
    width: 38, height: 38, borderRadius: '50%',
    overflow: 'hidden', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--accent)',
  },
  avatarImg: { width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' },
  headerInfo: { flex: 1, minWidth: 0, overflow: 'hidden' },
  myNick: {
    fontSize: 14, fontWeight: 700,
    color: 'var(--header-text)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  myId: { fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  headerBtn: { width: 30, height: 30, flexShrink: 0 },
  statusSelect: {
    height: 28,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: 11,
    padding: '0 4px',
    outline: 'none',
    flexShrink: 0,
    maxWidth: 86,
  },
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
  bottomBar: {
    padding: '8px 12px',
    borderTop: '1px solid var(--divider)',
    background: 'var(--header-bg)',
    fontSize: 11,
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
  },
  bottomItem: { whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 },
  bottomSep: { opacity: 0.4 },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
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
