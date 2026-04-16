import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store'
import ChatWindow from '../components/ChatWindow'
import ChannelWindow from '../components/ChannelWindow'
import ToastContainer from '../components/Toast'

export interface PopoutData {
  type: 'chat' | 'channel'
  // chat
  chatId?: number
  peerKey?: string
  peerName?: string
  // channel
  channelId?: string
  channelName?: string
}

// Применяем тему СИНХРОННО сразу при загрузке модуля — до первого рендера.
// Без этого окно будет белым пока не разрешится async invoke.
;(function applyThemeSync() {
  const saved = localStorage.getItem('soviet_theme')
  const dark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
})()

export default function ChatPopout({ data }: { data: PopoutData }) {
  const {
    loadIdentity, loadContacts, loadChats, loadChannels,
    setActiveChat, setActiveChannel,
    loadMessages, addChannelMessage,
    applyMessageEdit, applyMessageDelete,
    applyChannelEdit, applyChannelDelete, applyChannelReaction,
    updateReaction, updateContactStatus, setTyping,
  } = useStore()

  useEffect(() => {
    // Блокируем браузерное контекстное меню
    const preventCtx = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', preventCtx)

    // Уточняем тему из настроек (асинхронно, обновляет если нужно)
    invoke<any>('get_settings').then(s => {
      const t = s?.theme ?? 'system'
      if (t === 'dark')       document.documentElement.setAttribute('data-theme', 'dark')
      else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
      else {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
      }
      // Сохраняем для следующего синхронного запуска
      localStorage.setItem('soviet_theme', t === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : t)
    }).catch(() => {})

    // Восстановить масштаб
    const scale = localStorage.getItem('uiScale')
    if (scale) document.documentElement.style.zoom = `${scale}%`

    // Инициализация данных
    async function init() {
      await loadIdentity()
      await loadContacts()

      if (data.type === 'chat') {
        await loadChats()
        const st = useStore.getState()
        const found = st.chats.find(c =>
          (data.chatId && data.chatId > 0 && c.id === data.chatId) ||
          (data.peerKey && c.peer_key === data.peerKey)
        )
        setActiveChat(found ?? {
          id: data.chatId ?? -1,
          chat_type: 'direct',
          peer_key: data.peerKey ?? '',
          group_id: null,
          created_at: Date.now() / 1000,
          last_message: null,
          last_message_time: null,
          unread_count: 0,
          group_name: null,
        })
      } else {
        // Устанавливаем канал немедленно из данных попаута — ChannelWindow
        // рендерится сразу, без белого/пустого экрана "Выберите канал"
        setActiveChannel({
          channel_id: data.channelId ?? '',
          name: data.channelName ?? '',
          about: '',
          picture: '',
          creator_pubkey: '',
          relay: '',
          unread_count: 0,
          last_message: null,
          last_message_time: null,
        })
        // Затем подгружаем полные данные и обновляем
        await loadChannels()
        const st = useStore.getState()
        const ch = st.channels.find(c => c.channel_id === data.channelId)
        if (ch) setActiveChannel(ch)
      }
    }

    init()

    // Tauri event listeners — только то, что нужно для чата
    const ul1 = listen<{ chat_id: number; sender_pk: string; sender_name: string; preview: string }>(
      'new-message', async (e) => {
        const { chat_id } = e.payload
        await loadChats()
        const { activeChat } = useStore.getState()
        if (activeChat?.id === chat_id || activeChat?.peer_key === e.payload.sender_pk) {
          loadMessages(chat_id)
        }
      }
    )
    const ul2 = listen<{ message_id: number; new_content: string }>('message-edited', (e) =>
      applyMessageEdit(e.payload.message_id, e.payload.new_content)
    )
    const ul3 = listen<{ message_id: number }>('message-deleted', (e) =>
      applyMessageDelete(e.payload.message_id)
    )
    const ul4 = listen<{ message_id: number; sender_pk: string; emoji: string; action: string }>(
      'reaction-update', (e) =>
        updateReaction(e.payload.message_id, e.payload.sender_pk, e.payload.emoji, e.payload.action as 'add' | 'remove')
    )
    const ul5 = listen<{ peer_pk: string }>('read-receipt', (e) => {
      const { activeChat } = useStore.getState()
      if (activeChat?.peer_key === e.payload.peer_pk) {
        useStore.setState(s => ({
          messages: s.messages.map(m =>
            m.sender_key !== e.payload.peer_pk ? { ...m, status: 'read' as const } : m
          )
        }))
      }
    })
    const ul6 = listen<{ sender_pk: string; is_typing: boolean }>('typing', (e) =>
      setTyping(e.payload.sender_pk, e.payload.is_typing)
    )
    const ul7 = listen<{ pk: string; status: string; status_text?: string; avatar?: string }>(
      'contact-status', (e) =>
        updateContactStatus(e.payload.pk, e.payload.status, e.payload.status_text, e.payload.avatar)
    )
    // Nostr канал
    const ul8  = listen<any>('nostr-message', (e) => addChannelMessage(e.payload))
    const ul9  = listen<{ event_id: string; new_content: string; edited_at: number }>('nostr-message-edited', (e) =>
      applyChannelEdit(e.payload.event_id, e.payload.new_content, e.payload.edited_at)
    )
    const ul10 = listen<{ event_id: string }>('nostr-message-deleted', (e) =>
      applyChannelDelete(e.payload.event_id)
    )
    const ul11 = listen<any>('nostr-reaction', (e) => applyChannelReaction(e.payload))

    return () => {
      document.removeEventListener('contextmenu', preventCtx)
      ;[ul1, ul2, ul3, ul4, ul5, ul6, ul7, ul8, ul9, ul10, ul11]
        .forEach(p => p.then(f => f()))
    }
  }, [])

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {data.type === 'chat' ? <ChatWindow /> : <ChannelWindow />}
      <ToastContainer />
    </div>
  )
}
