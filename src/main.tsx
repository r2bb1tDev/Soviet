import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ChatPopout from './pages/ChatPopout'
import './styles/global.css'
import { useStore } from './store'

const popout = (window as any).__POPOUT__

// Прайминг Zustand-стора ДО первого рендера React — иначе ChatWindow/ChannelWindow
// возвращают null (activeChat/activeChannel === null) на первом рендере и пользователь
// видит белое окно навсегда.
//
// ВАЖНО: используем useStore.setState() напрямую, а НЕ setActiveChat/setActiveChannel.
// setActive* вызывают loadMessages/loadChannelMessages → invoke() сразу,
// но на этом этапе Tauri IPC ещё не инициализирован → invoke бросает исключение
// → состояние остаётся сломанным. setState() только пишет данные, без invoke.
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
