import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ChatPopout from './pages/ChatPopout'
import { PopoutData } from './pages/ChatPopout'
import './styles/global.css'
import { useStore } from './store'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Определяем — это попаут-окно или главное.
// Используем label окна из Tauri internals: chat-* или chan-* → попаут.
// Это единственный 100% надёжный способ: не зависит от initialization_script,
// sessionStorage, URL-параметров — label доступен синхронно всегда.
const windowLabel = getCurrentWindow().label
const isPopout = windowLabel.startsWith('chat-') || windowLabel.startsWith('chan-')

async function bootstrap() {
  if (!isPopout) {
    // Главное окно — рендерим App сразу
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><App /></React.StrictMode>
    )
    return
  }

  // Попаут-окно: получаем данные из Rust AppState через invoke.
  // Данные туда записывает open_chat_window/open_channel_window перед созданием окна.
  let popout: PopoutData | null = null
  try {
    const data = await invoke<any>('get_popout_data', { label: windowLabel })
    if (data?.type === 'chat' || data?.type === 'channel') {
      popout = data as PopoutData
    }
  } catch (e) {
    console.error('get_popout_data failed:', e)
  }

  // Применяем тему из данных попаута
  if (popout && (popout as any).theme) {
    document.documentElement.setAttribute('data-theme', (popout as any).theme)
  }

  if (!popout) {
    // Данные не пришли — рендерим пустой App чтобы окно хотя бы открылось
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><App /></React.StrictMode>
    )
    return
  }

  // Прайминг стора ДО рендера через setState() (без invoke — IPC только что отработал).
  if (popout.type === 'chat') {
    useStore.setState({
      activeChat: {
        id: popout.chatId ?? -1,
        chat_type: 'direct',
        peer_key: popout.peerKey ?? '',
        group_id: null,
        created_at: Date.now() / 1000,
        last_message: null,
        last_message_time: null,
        unread_count: 0,
        group_name: null,
      },
      messages: [],
      decryptedMessages: {},
      reactions: {},
    })
  } else {
    useStore.setState({
      activeChannel: {
        channel_id: popout.channelId ?? '',
        name: popout.channelName ?? '',
        about: '',
        picture: '',
        creator_pubkey: '',
        relay: '',
        unread_count: 0,
        last_message: null,
        last_message_time: null,
      },
      channelMessages: [],
    })
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ChatPopout data={popout} />
    </React.StrictMode>
  )
}

bootstrap()
