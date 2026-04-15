import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ChatPopout from './pages/ChatPopout'
import './styles/global.css'

const popout = (window as any).__POPOUT__

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popout ? <ChatPopout data={popout} /> : <App />}
  </React.StrictMode>
)
