import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ChatPopout from './pages/ChatPopout'
import { PopoutData } from './pages/ChatPopout'
import './styles/global.css'
import { useStore } from './store'

// Читаем данные попаута из URL query-параметров.
// Это единственный надёжный способ в Tauri v2 + Vite dev режиме:
// initialization_script выполняется до Vite runtime и затирается HMR,
// тогда как URL-параметры всегда доступны до любого JS.
function getPopoutData(): PopoutData | null {
  const p = new URLSearchParams(window.location.search)
  const type = p.get('popout')
  if (type === 'chat') {
    return {
      type: 'chat',
      chatId: Number(p.get('chatId') ?? '-1'),
      peerKey: p.get('peerKey') ?? '',
      peerName: p.get('peerName') ?? '',
    }
  }
  if (type === 'channel') {
    return {
      type: 'channel',
      channelId: p.get('channelId') ?? '',
      channelName: p.get('channelName') ?? '',
    }
  }
  return null
}

// Применяем тему из URL-параметра немедленно (до рендера)
const themeParam = new URLSearchParams(window.location.search).get('theme')
if (themeParam === 'dark' || themeParam === 'light') {
  document.documentElement.setAttribute('data-theme', themeParam)
}

const popout = getPopoutData()

// Прайминг Zustand-стора ДО первого рендера React через setState() (без invoke).
// setActiveChat/setActiveChannel вызывают invoke() сразу — до готовности Tauri IPC.
if (popout) {
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
  } else if (popout.type === 'channel') {
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
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popout ? <ChatPopout data={popout} /> : <App />}
  </React.StrictMode>
)
