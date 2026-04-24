import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface ToastItem {
  id: number
  type: 'message' | 'request' | 'error' | 'success'
  title: string
  body?: string
  chatId?: number
  senderPk?: string
}

export interface Contact {
  id: number
  public_key: string
  nickname: string
  local_alias: string | null
  status: 'online' | 'away' | 'na' | 'dnd' | 'invisible' | 'offline'
  status_text: string | null
  last_seen: number | null
  notes: string | null
  is_blocked: boolean
  is_favorite: boolean
  added_at: number
  verified: boolean
  avatar_data: string | null
  local_folder?: string | null
}

export interface Message {
  id: number
  chat_id: number
  sender_key: string
  content: string
  content_type: string
  timestamp: number
  status: 'sent' | 'delivered' | 'read'
  reply_to: number | null
  edited_at: number | null
  is_deleted: boolean
  plaintext: string | null  // open text from DB (own sent messages)
}

export interface Reaction {
  id: number
  message_id: number
  sender_key: string
  emoji: string
  created_at: number
}

export interface Chat {
  id: number
  chat_type: 'direct' | 'group'
  peer_key: string | null
  group_id: string | null
  created_at: number
  last_message: string | null
  last_message_time: number | null
  unread_count: number
  group_name: string | null  // имя группы (только для group-чатов)
}

export interface Identity {
  nickname: string
  public_key: string
  has_identity: boolean
}

export interface LanPeer {
  nickname: string
  public_key: string
  addr: string
  port: number
  version: number
}

export interface P2pPeer {
  peer_id: string
  soviet_pk: string | null
  addrs: string[]
}

export interface ContactRequest {
  id: number
  public_key: string
  nickname: string
  direction: string
  status: string
  created_at: number
}

export interface GroupMember {
  group_id: string
  public_key: string
  nickname: string
  is_admin: boolean
  joined_at: number
}

export interface NostrChannel {
  channel_id: string
  name: string
  about: string
  picture: string
  creator_pubkey: string
  relay: string
  unread_count: number
  last_message: string | null
  last_message_time: number | null
}

export interface NostrMessage {
  id: number
  event_id: string
  channel_id: string
  sender_pubkey: string
  sender_name: string | null
  content: string
  timestamp: number
  reply_to: string | null
  is_mine: boolean
  edited_at: number | null
  is_deleted: boolean
}

export interface ChannelReaction {
  id: number
  event_id: string
  channel_id: string
  reactor_pubkey: string
  emoji: string
  reaction_event_id: string | null
  created_at: number
}

export interface ChannelMedia {
  type: 'image' | 'video' | 'audio' | 'gif'
  data: string   // data URL base64
  name: string
  size?: number
}

export interface PollData {
  q: string       // вопрос
  opts: string[]  // варианты ответа (2–10)
}

/** Parse content field: returns { text, media, poll } */
export function parseChannelContent(content: string): { text: string; media: ChannelMedia | null; poll: PollData | null } {
  try {
    const obj = JSON.parse(content)
    if (obj && obj.v === 1) {
      return { text: obj.text ?? '', media: obj.media ?? null, poll: obj.poll ?? null }
    }
  } catch { /* plain text */ }
  return { text: content, media: null, poll: null }
}

/** Build content field with optional media */
export function buildChannelContent(text: string, media?: ChannelMedia | null): string {
  if (!media) return text
  return JSON.stringify({ v: 1, text, media })
}

/** Build content field for a poll */
export function buildPollContent(question: string, opts: string[]): string {
  return JSON.stringify({ v: 1, text: '', poll: { q: question, opts } })
}

export interface SearchResult {
  msg_id: number
  chat_id: number
  sender_key: string
  plaintext: string
  timestamp: number
  content_type: string
  chat_type: string
  peer_key: string | null
  group_id: string | null
}

let toastIdCounter = 1

interface AppStore {
  // Identity
  identity: Identity | null
  setIdentity: (id: Identity) => void
  loadIdentity: () => Promise<void>

  // Contacts
  contacts: Contact[]
  lanPeers: LanPeer[]
  p2pPeers: P2pPeer[]
  loadContacts: () => Promise<void>
  loadLanPeers: () => Promise<void>
  loadP2pPeers: () => Promise<void>
  addContact: (pk: string, nick: string) => Promise<void>
  deleteContact: (pk: string) => Promise<void>
  updateContactStatus: (pk: string, status: string, statusText?: string, avatar?: string) => void

  // Contact Requests
  contactRequests: ContactRequest[]
  loadContactRequests: () => Promise<void>

  // Chats & Messages
  chats: Chat[]
  activeChat: Chat | null
  openTabs: Chat[]
  activeTabId: number | null
  pinnedTabIds: Set<number>
  recentlyClosedTabs: Chat[]
  messages: Message[]
  decryptedMessages: Record<number, string>
  reactions: Record<number, Reaction[]>
  loadChats: () => Promise<void>
  setActiveChat: (chat: Chat | null) => void
  openTab: (chat: Chat) => void
  closeTab: (chatId: number) => void
  switchTab: (chatId: number) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  togglePinTab: (chatId: number) => void
  reopenLastClosedTab: () => void
  loadMessages: (chatId: number) => Promise<void>
  loadMoreMessages: (chatId: number, beforeTs: number) => Promise<number>
  sendMessage: (recipientPk: string, text: string, replyToId?: number | null) => Promise<void>
  decryptMessage: (msg: Message) => Promise<string>
  addReaction: (msgId: number, chatId: number, emoji: string) => Promise<void>
  removeReaction: (msgId: number, chatId: number, emoji: string) => Promise<void>
  editMessage: (msgId: number, chatId: number, newText: string) => Promise<void>
  deleteMessage: (msgId: number, chatId: number) => Promise<void>
  updateReaction: (msgId: number, senderKey: string, emoji: string, action: 'add' | 'remove') => void
  applyMessageEdit: (msgId: number, newContent: string) => void
  applyMessageDelete: (msgId: number) => void

  // Typing indicators
  typingUsers: Record<string, boolean>
  setTyping: (pk: string, isTyping: boolean) => void
  sendTyping: (recipientPk: string, isTyping: boolean) => Promise<void>

  // UI state
  page: 'onboarding' | 'main' | 'settings'
  setPage: (p: 'onboarding' | 'main' | 'settings') => void
  sidebarSearch: string
  setSidebarSearch: (s: string) => void

  // Status
  myStatus: string
  setMyStatus: (s: string, text?: string) => Promise<void>

  // Avatar
  myAvatar: string | null
  setMyAvatar: (data: string | null) => void

  // Toasts
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id'>) => void
  removeToast: (id: number) => void

  // File transfer
  sendFile: (recipientPk: string, fileName: string, mimeType: string, dataBase64: string) => Promise<void>

  // Groups
  createGroup: (name: string, memberPks: string[]) => Promise<string>
  sendGroupMessage: (groupId: string, text: string) => Promise<void>
  getGroupMembers: (groupId: string) => Promise<GroupMember[]>
  leaveGroup: (groupId: string) => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  deleteChat: (chatId: number) => Promise<void>

  // Nostr Channels
  nostrPubkey: string | null
  channels: NostrChannel[]
  activeChannel: NostrChannel | null
  channelMessages: NostrMessage[]
  channelReactions: Record<string, ChannelReaction[]>  // event_id → reactions
  loadChannels: () => Promise<void>
  setActiveChannel: (ch: NostrChannel | null) => void
  loadChannelMessages: (channelId: string) => Promise<void>
  loadChannelReactions: (channelId: string) => Promise<void>
  sendChannelMessage: (channelId: string, content: string, replyTo?: string) => Promise<void>
  editChannelMessage: (eventId: string, channelId: string, newContent: string) => Promise<void>
  deleteChannelMessage: (eventId: string) => Promise<void>
  sendChannelReaction: (eventId: string, channelId: string, authorPubkey: string, emoji: string) => Promise<void>
  removeChannelReaction: (reactionEventId: string) => Promise<void>
  sendComment: (channelId: string, parentEventId: string, content: string) => Promise<void>
  createChannel: (name: string, about: string) => Promise<string>
  joinChannel: (channelId: string, relay?: string) => Promise<void>
  leaveChannel: (channelId: string) => Promise<void>
  markChannelRead: (channelId: string) => Promise<void>
  addChannelMessage: (msg: NostrMessage) => void
  applyChannelEdit: (eventId: string, newContent: string, editedAt: number) => void
  applyChannelDelete: (eventId: string) => void
  applyChannelReaction: (r: ChannelReaction) => void
  updateChannelMeta: (channelId: string, name: string, about: string, picture: string) => Promise<void>
  deleteChannel: (channelId: string) => Promise<void>
  getSubscriberCount: (channelId: string) => Promise<number>

  // Message search
  searchResults: SearchResult[]
  searchQuery: string
  searchMessages: (query: string) => Promise<void>
  clearSearch: () => void
}

export const useStore = create<AppStore>((set, get) => ({
  identity: null,
  setIdentity: (id) => set({ identity: id }),
  loadIdentity: async () => {
    const id = await invoke<Identity>('get_identity')
    if (id.has_identity) {
      set({ identity: id, page: 'main' })
      // Загружаем аватар
      try {
        const s = await invoke<any>('get_settings')
        if (s.avatar_data) set({ myAvatar: s.avatar_data })
      } catch { /* ignore */ }
    } else {
      set({ page: 'onboarding' })
    }
  },

  contacts: [],
  lanPeers: [],
  p2pPeers: [],
  loadContacts: async () => {
    const contacts = await invoke<Contact[]>('get_contacts')
    set({ contacts })
  },
  loadLanPeers: async () => {
    const lanPeers = await invoke<LanPeer[]>('get_lan_peers')
    set({ lanPeers })
    // Помечаем LAN-контакты как online (используем updater чтобы читать актуальный contacts)
    set(s => ({
      contacts: s.contacts.map(c => {
        const inLan = lanPeers.some(p => p.public_key === c.public_key)
        if (inLan && c.status === 'offline') return { ...c, status: 'online' as const }
        return c
      })
    }))
  },
  loadP2pPeers: async () => {
    try {
      const p2pPeers = await invoke<P2pPeer[]>('get_p2p_peers')
      set({ p2pPeers })
      // Помечаем P2P-контакты как online (используем updater чтобы читать актуальный contacts)
      set(s => ({
        contacts: s.contacts.map(c => {
          const inP2p = p2pPeers.some(p =>
            p.soviet_pk === c.public_key
          )
          if (inP2p && c.status === 'offline') return { ...c, status: 'online' as const }
          return c
        })
      }))
    } catch { /* P2P may not be ready yet */ }
  },
  addContact: async (pk, _nick) => {
    // ICQ-логика: сначала отправляем запрос, контакт появится после принятия
    await invoke('send_contact_request', { recipientPk: pk })
    get().loadContactRequests()
  },
  deleteContact: async (pk) => {
    await invoke('delete_contact', { publicKey: pk })
    get().loadContacts()
  },
  updateContactStatus: (pk, status, statusText?: string, avatar?: string) => {
    set(s => ({
      contacts: s.contacts.map(c =>
        c.public_key === pk ? {
          ...c,
          status: status as any,
          ...(statusText !== undefined ? { status_text: statusText } : {}),
          ...(avatar ? { avatar_data: avatar } : {}),
        } : c
      )
    }))
  },

  contactRequests: [],
  loadContactRequests: async () => {
    const contactRequests = await invoke<ContactRequest[]>('get_contact_requests')
    set({ contactRequests })
  },

  chats: [],
  activeChat: null,
  openTabs: [],
  activeTabId: null,
  pinnedTabIds: new Set<number>(),
  recentlyClosedTabs: [],
  messages: [],
  decryptedMessages: {},
  reactions: {},
  loadChats: async () => {
    const chats = await invoke<Chat[]>('get_chats')
    set({ chats })
  },
  setActiveChat: (chat) => {
    set({ activeChat: chat, messages: [], decryptedMessages: {}, reactions: {} })
    if (chat) {
      // Auto-add to tabs
      set(s => {
        const tabId = chat.id
        const alreadyOpen = s.openTabs.some(t => t.id === tabId)
        return {
          openTabs: alreadyOpen ? s.openTabs : [...s.openTabs, chat],
          activeTabId: tabId,
        }
      })
    } else {
      set({ activeTabId: null })
    }
    if (chat && chat.id > 0) get().loadMessages(chat.id)
    // Обновляем контакты при переходе в чат — синхронизация аватарок
    get().loadContacts()
  },
  openTab: (chat) => {
    set(s => {
      const alreadyOpen = s.openTabs.some(t => t.id === chat.id)
      return {
        openTabs: alreadyOpen ? s.openTabs : [...s.openTabs, chat],
        activeTabId: chat.id,
        activeChat: chat,
        messages: [],
        decryptedMessages: {},
        reactions: {},
      }
    })
    if (chat.id > 0) get().loadMessages(chat.id)
    get().loadContacts()
  },
  closeTab: (chatId) => {
    set(s => {
      const closing = s.openTabs.find(t => t.id === chatId)
      const remaining = s.openTabs.filter(t => t.id !== chatId)
      const wasActive = s.activeTabId === chatId
      let newActiveTabId = s.activeTabId
      let newActiveChat = s.activeChat
      if (wasActive) {
        const last = remaining[remaining.length - 1] ?? null
        newActiveTabId = last?.id ?? null
        newActiveChat = last
      }
      const newPinned = new Set(s.pinnedTabIds)
      newPinned.delete(chatId)
      const recentlyClosed = closing
        ? [closing, ...s.recentlyClosedTabs.slice(0, 9)]
        : s.recentlyClosedTabs
      return {
        openTabs: remaining,
        activeTabId: newActiveTabId,
        activeChat: newActiveChat,
        pinnedTabIds: newPinned,
        recentlyClosedTabs: recentlyClosed,
        messages: wasActive ? [] : s.messages,
        decryptedMessages: wasActive ? {} : s.decryptedMessages,
        reactions: wasActive ? {} : s.reactions,
      }
    })
    const { activeTabId } = get()
    if (activeTabId && activeTabId > 0) get().loadMessages(activeTabId)
  },
  reorderTabs: (fromIndex, toIndex) => {
    set(s => {
      const tabs = [...s.openTabs]
      const [moved] = tabs.splice(fromIndex, 1)
      tabs.splice(toIndex, 0, moved)
      return { openTabs: tabs }
    })
  },
  togglePinTab: (chatId) => {
    set(s => {
      const pinned = new Set(s.pinnedTabIds)
      if (pinned.has(chatId)) pinned.delete(chatId)
      else pinned.add(chatId)
      return { pinnedTabIds: pinned }
    })
  },
  reopenLastClosedTab: () => {
    const { recentlyClosedTabs } = get()
    if (!recentlyClosedTabs.length) return
    const [tab, ...rest] = recentlyClosedTabs
    set({ recentlyClosedTabs: rest })
    get().openTab(tab)
  },
  switchTab: (chatId) => {
    const { openTabs } = get()
    const chat = openTabs.find(t => t.id === chatId)
    if (!chat) return
    set({ activeTabId: chatId, activeChat: chat, messages: [], decryptedMessages: {}, reactions: {} })
    if (chatId > 0) get().loadMessages(chatId)
  },
  loadMessages: async (chatId) => {
    const messages = await invoke<Message[]>('get_messages', { chatId, limit: 50 })
    set({ messages })
    await invoke('mark_read', { chatId })
    // Расшифровываем (параллельно, чтобы не было задержек)
    // Используем plaintext из БД если есть (для своих отправленных сообщений)
    const decryptedPairs = await Promise.all(messages.map(async (msg) => {
      if (msg.is_deleted) return [msg.id, '[Сообщение удалено]'] as const
      if (msg.content_type === 'system') return [msg.id, msg.content] as const
      // Если есть plaintext в БД — используем его напрямую (не нужна расшифровка)
      if (msg.plaintext) return [msg.id, msg.plaintext] as const
      try {
        const text = await invoke<string>('decrypt_message_text', { encryptedJson: msg.content })
        return [msg.id, text] as const
      } catch {
        const maybePlain = (msg.content ?? '').trim()
        const looksLikeEncryptedJson = maybePlain.startsWith('{') && maybePlain.includes('"ciphertext"')
        return [msg.id, looksLikeEncryptedJson ? '[не удалось расшифровать]' : maybePlain] as const
      }
    }))
    set({ decryptedMessages: Object.fromEntries(decryptedPairs) })
    // Load reactions
    try {
      const rxList = await invoke<Reaction[]>('get_reactions', { chatId })
      const reactions: Record<number, Reaction[]> = {}
      for (const r of rxList) {
        if (!reactions[r.message_id]) reactions[r.message_id] = []
        reactions[r.message_id].push(r)
      }
      set({ reactions })
    } catch { /* ignore */ }
    get().loadChats()
  },
  loadMoreMessages: async (chatId, beforeTs) => {
    const more = await invoke<Message[]>('get_messages', { chatId, limit: 50, before: beforeTs })
    if (!more || more.length === 0) return 0
    set(s => {
      const existingIds = new Set(s.messages.map(m => m.id))
      const merged = [...more.filter(m => !existingIds.has(m.id)), ...s.messages]
      return { messages: merged }
    })
    // Расшифровываем только добавленные
    const st = get()
    const decryptedPairs = await Promise.all(more.map(async (msg) => {
      if (msg.is_deleted) return [msg.id, '[Сообщение удалено]'] as const
      if (msg.content_type === 'system') return [msg.id, msg.content] as const
      if (msg.plaintext) return [msg.id, msg.plaintext] as const
      try {
        const text = await invoke<string>('decrypt_message_text', { encryptedJson: msg.content })
        return [msg.id, text] as const
      } catch {
        const maybePlain = (msg.content ?? '').trim()
        const looksLikeEncryptedJson = maybePlain.startsWith('{') && maybePlain.includes('"ciphertext"')
        return [msg.id, looksLikeEncryptedJson ? '[не удалось расшифровать]' : maybePlain] as const
      }
    }))
    set({ decryptedMessages: { ...st.decryptedMessages, ...Object.fromEntries(decryptedPairs) } })
    return more.length
  },
  sendMessage: async (recipientPk, text, replyToId) => {
    await invoke('send_message', { recipientPk, text, replyTo: replyToId ?? null })
    const { activeChat } = get()
    if (activeChat && activeChat.id > 0) {
      get().loadMessages(activeChat.id)
    } else if (activeChat) {
      // Чат ещё создаётся — перезагружаем все чаты и находим новый
      await get().loadChats()
      const { chats } = get()
      const newChat = chats.find(c => c.chat_type === 'direct' && c.peer_key === recipientPk)
      if (newChat) {
        set({ activeChat: newChat })
        get().loadMessages(newChat.id)
      }
    }
    get().loadChats()
  },
  decryptMessage: async (msg) => {
    const { decryptedMessages } = get()
    if (decryptedMessages[msg.id]) return decryptedMessages[msg.id]
    try {
      const text = await invoke<string>('decrypt_message_text', { encryptedJson: msg.content })
      set(s => ({ decryptedMessages: { ...s.decryptedMessages, [msg.id]: text } }))
      return text
    } catch {
      return '[зашифрованное сообщение]'
    }
  },

  addReaction: async (msgId, chatId, emoji) => {
    await invoke('add_reaction_cmd', { msgId, chatId, emoji })
  },
  removeReaction: async (msgId, chatId, emoji) => {
    await invoke('remove_reaction_cmd', { msgId, chatId, emoji })
  },
  editMessage: async (msgId, chatId, newText) => {
    await invoke('edit_message_cmd', { msgId, chatId, newText })
  },
  deleteMessage: async (msgId, chatId) => {
    await invoke('delete_message_cmd', { msgId, chatId })
    // Обновляем preview в сайдбаре после удаления
    set(s => ({
      messages: s.messages.map(m => m.id === msgId ? { ...m, is_deleted: true } : m),
      decryptedMessages: { ...s.decryptedMessages, [msgId]: '[Сообщение удалено]' },
    }))
    get().loadChats()
  },
  updateReaction: (msgId, senderKey, emoji, action) => {
    set(s => {
      const prev = s.reactions[msgId] ?? []
      let updated: Reaction[]
      if (action === 'add') {
        const exists = prev.some(r => r.sender_key === senderKey && r.emoji === emoji)
        if (exists) return {}
        const newR: Reaction = { id: Date.now(), message_id: msgId, sender_key: senderKey, emoji, created_at: Date.now() / 1000 }
        updated = [...prev, newR]
      } else {
        updated = prev.filter(r => !(r.sender_key === senderKey && r.emoji === emoji))
      }
      return { reactions: { ...s.reactions, [msgId]: updated } }
    })
  },
  applyMessageEdit: (msgId, newContent) => {
    set(s => ({
      messages: s.messages.map(m => m.id === msgId ? { ...m, edited_at: Math.floor(Date.now()/1000) } : m),
      decryptedMessages: { ...s.decryptedMessages, [msgId]: newContent },
    }))
  },
  applyMessageDelete: (msgId) => {
    set(s => ({
      messages: s.messages.map(m => m.id === msgId ? { ...m, is_deleted: true } : m),
      decryptedMessages: { ...s.decryptedMessages, [msgId]: '[Сообщение удалено]' },
    }))
    // Перезагружаем чаты чтобы обновить preview в сайдбаре
    get().loadChats()
  },

  typingUsers: {},
  setTyping: (pk, isTyping) => {
    set(s => ({ typingUsers: { ...s.typingUsers, [pk]: isTyping } }))
    if (isTyping) {
      // Автосброс через 4 секунды
      setTimeout(() => {
        set(s => {
          const updated = { ...s.typingUsers }
          delete updated[pk]
          return { typingUsers: updated }
        })
      }, 4000)
    }
  },
  sendTyping: async (recipientPk, isTyping) => {
    try {
      await invoke('send_typing', { recipientPk, isTyping })
    } catch { /* LAN может не работать */ }
  },

  page: 'onboarding',
  setPage: (page) => set({ page }),
  sidebarSearch: '',
  setSidebarSearch: (sidebarSearch) => set({ sidebarSearch }),

  myStatus: 'online',
  setMyStatus: async (status, text = '') => {
    set({ myStatus: status })           // UI обновляется сразу
    invoke('set_status', { status, text }).catch(() => {}) // сохраняем в БД фоново
  },

  myAvatar: null,
  setMyAvatar: (data) => set({ myAvatar: data }),

  toasts: [],
  addToast: (toast) => {
    const id = toastIdCounter++
    set(s => ({ toasts: [...s.toasts, { ...toast, id }] }))
  },
  removeToast: (id) => {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  },

  // File transfer
  sendFile: async (recipientPk, fileName, mimeType, dataBase64) => {
    await invoke('send_file', { recipientPk, fileName, mimeType, dataBase64 })
    const { activeChat } = get()
    if (activeChat && activeChat.id > 0) await get().loadMessages(activeChat.id)
    await get().loadChats()
  },

  // Groups
  createGroup: async (name, memberPks) => {
    const groupId = await invoke<string>('create_group', { name, memberPks })
    await get().loadChats()
    return groupId
  },
  sendGroupMessage: async (groupId, text) => {
    await invoke('send_group_message', { groupId, text })
    await get().loadChats()
    const { activeChat } = get()
    if (activeChat?.group_id === groupId) {
      await get().loadMessages(activeChat.id)
    }
  },
  getGroupMembers: async (groupId) => {
    return await invoke<GroupMember[]>('get_group_members', { groupId })
  },
  leaveGroup: async (groupId) => {
    await invoke('leave_group', { groupId })
    get().loadChats()
  },
  deleteGroup: async (groupId) => {
    await invoke('delete_group', { groupId })
    get().loadChats()
  },
  deleteChat: async (chatId) => {
    await invoke('delete_chat', { chatId })
    set(s => ({
      chats: s.chats.filter(c => c.id !== chatId),
      activeChat: s.activeChat?.id === chatId ? null : s.activeChat,
      messages: s.activeChat?.id === chatId ? [] : s.messages,
    }))
  },

  // Nostr Channels
  nostrPubkey: null,
  channels: [],
  activeChannel: null,
  channelMessages: [],
  channelReactions: {},

  loadChannels: async () => {
    const [channels, pubkey] = await Promise.all([
      invoke<NostrChannel[]>('nostr_get_channels'),
      invoke<string>('nostr_get_pubkey'),
    ])
    set({ channels, nostrPubkey: pubkey || null })
  },

  setActiveChannel: (ch) => {
    set({ activeChannel: ch, channelMessages: [] })
    if (ch) {
      get().loadChannelMessages(ch.channel_id)
      get().markChannelRead(ch.channel_id)
    }
  },

  loadChannelMessages: async (channelId) => {
    const msgs = await invoke<NostrMessage[]>('nostr_get_messages', { channelId, limit: 200 })
    set({ channelMessages: msgs })
    get().loadChannelReactions(channelId)
  },

  loadChannelReactions: async (channelId) => {
    try {
      const rows = await invoke<ChannelReaction[]>('nostr_get_channel_reactions', { channelId })
      const byEvent: Record<string, ChannelReaction[]> = {}
      for (const r of rows) {
        if (!byEvent[r.event_id]) byEvent[r.event_id] = []
        byEvent[r.event_id].push(r)
      }
      set(s => ({ channelReactions: { ...s.channelReactions, ...byEvent } }))
    } catch { /* ignore */ }
  },

  sendChannelMessage: async (channelId, content, replyTo) => {
    await invoke('nostr_send_channel_message', { channelId, content, replyTo: replyTo ?? null })
  },

  editChannelMessage: async (eventId, channelId, newContent) => {
    await invoke('nostr_edit_channel_message', { eventId, channelId, newContent })
    get().applyChannelEdit(eventId, newContent, Math.floor(Date.now() / 1000))
  },

  deleteChannelMessage: async (eventId) => {
    await invoke('nostr_delete_channel_message', { eventId })
    get().applyChannelDelete(eventId)
  },

  sendChannelReaction: async (eventId, channelId, authorPubkey, emoji) => {
    await invoke('nostr_send_channel_reaction', { eventId, channelId, authorPubkey, emoji })
  },

  removeChannelReaction: async (reactionEventId) => {
    await invoke('nostr_remove_channel_reaction', { reactionEventId })
    set(s => {
      const next: Record<string, ChannelReaction[]> = {}
      for (const [eid, rs] of Object.entries(s.channelReactions)) {
        const filtered = rs.filter(r => r.reaction_event_id !== reactionEventId)
        if (filtered.length) next[eid] = filtered
      }
      return { channelReactions: next }
    })
  },

  sendComment: async (channelId, parentEventId, content) => {
    await invoke('nostr_send_comment', { channelId, parentEventId, content })
  },

  applyChannelEdit: (eventId, newContent, editedAt) => {
    set(s => ({
      channelMessages: s.channelMessages.map(m =>
        m.event_id === eventId ? { ...m, content: newContent, edited_at: editedAt } : m
      )
    }))
  },

  applyChannelDelete: (eventId) => {
    set(s => ({
      channelMessages: s.channelMessages.map(m =>
        m.event_id === eventId ? { ...m, is_deleted: true } : m
      )
    }))
  },

  applyChannelReaction: (r) => {
    set(s => {
      const prev = s.channelReactions[r.event_id] ?? []
      const exists = prev.some(x => x.reactor_pubkey === r.reactor_pubkey && x.emoji === r.emoji)
      if (exists) return {}
      return { channelReactions: { ...s.channelReactions, [r.event_id]: [...prev, r] } }
    })
  },

  createChannel: async (name, about) => {
    const channelId = await invoke<string>('nostr_create_channel', { name, about })
    await get().loadChannels()
    return channelId
  },

  joinChannel: async (channelId, relay) => {
    await invoke('nostr_join_channel', { channelId, relay: relay ?? null })
    await get().loadChannels()
  },

  leaveChannel: async (channelId) => {
    await invoke('nostr_leave_channel', { channelId })
    await get().loadChannels()
    const { activeChannel } = get()
    if (activeChannel?.channel_id === channelId) {
      set({ activeChannel: null, channelMessages: [] })
    }
  },

  markChannelRead: async (channelId) => {
    await invoke('nostr_mark_channel_read', { channelId })
    set(s => ({
      channels: s.channels.map(c =>
        c.channel_id === channelId ? { ...c, unread_count: 0 } : c
      )
    }))
  },

  updateChannelMeta: async (channelId, name, about, picture) => {
    await invoke('nostr_update_channel_meta', { channelId, name, about, picture })
    set(s => {
      const updated = (c: NostrChannel) => c.channel_id === channelId ? { ...c, name, about, picture } : c
      return {
        channels: s.channels.map(updated),
        activeChannel: s.activeChannel?.channel_id === channelId
          ? updated(s.activeChannel) : s.activeChannel,
      }
    })
  },

  deleteChannel: async (channelId) => {
    await invoke('nostr_delete_channel_cmd', { channelId })
    set(s => ({
      channels: s.channels.filter(c => c.channel_id !== channelId),
      activeChannel: s.activeChannel?.channel_id === channelId ? null : s.activeChannel,
      channelMessages: s.activeChannel?.channel_id === channelId ? [] : s.channelMessages,
    }))
  },
  getSubscriberCount: async (channelId) => {
    return await invoke<number>('nostr_get_subscriber_count', { channelId })
  },

  addChannelMessage: (msg) => {
    set(s => ({
      channelMessages: [...s.channelMessages, msg],
      channels: s.channels.map(c =>
        c.channel_id === msg.channel_id
          ? { ...c, last_message: msg.content, last_message_time: msg.timestamp }
          : c
      )
    }))
  },

  // ── Поиск сообщений ───────────────────────────────────────────────────────
  searchResults: [],
  searchQuery: '',
  searchMessages: async (query) => {
    set({ searchQuery: query })
    if (query.trim().length < 2) { set({ searchResults: [] }); return }
    try {
      const results = await invoke<SearchResult[]>('search_messages', { query })
      set({ searchResults: results })
    } catch { set({ searchResults: [] }) }
  },
  clearSearch: () => set({ searchResults: [], searchQuery: '' }),
}))
