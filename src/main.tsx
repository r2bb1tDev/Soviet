import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PopoutRoot from './PopoutRoot'
import './styles/global.css'

// Popout-окна открываются через тот же index.html — Tauri выставляет
// window.__sovietPopoutLabel через initialization_script. Если флаг есть,
// вместо главного <App/> рендерим PopoutRoot (чат/канал в отдельном окне).
// Popout-флаг устанавливается inline-скриптом в index.html при парсинге location.hash
// ("index.html#popout=chat-123"). Дополнительно парсим hash сами на случай если
// inline не успел — чтобы точно поймать.
const __hashPopout = (() => {
  try {
    const m = (location.hash || '').match(/popout=([^&]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  } catch { return '' }
})()
if (__hashPopout && !(window as any).__sovietPopoutLabel) {
  ;(window as any).__sovietPopoutLabel = __hashPopout
}
const isPopout = typeof (window as any).__sovietPopoutLabel === 'string'
  && (window as any).__sovietPopoutLabel.length > 0

// Применяем тему ДО монтирования React — избегаем белого мигания
;(function(){
  try {
    const s = localStorage.getItem('soviet_theme')
    const dark = s === 'dark' || (!s && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  } catch {}
})()

// Fatal error fallback — показываем сообщение прямо в body если React упал
function renderFatalError(msg: string) {
  const theme = document.documentElement.getAttribute('data-theme')
  const bg = theme === 'light' ? '#F4FFF7' : '#0A0A0A'
  const fg = theme === 'light' ? '#0A0A0A' : '#F4FFF7'
  const root = document.getElementById('root')
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:20px;box-sizing:border-box;background:${bg};color:${fg};font-family:system-ui,sans-serif;gap:12px;text-align:center;">
      <div style="font-size:48px;">⚠️</div>
      <div style="font-size:16px;font-weight:600;">Ошибка загрузки окна</div>
      <div style="font-size:12px;opacity:0.75;max-width:420px;word-break:break-word;white-space:pre-wrap;">${String(msg).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      <button onclick="window.close()" style="margin-top:8px;padding:8px 20px;font-size:13px;background:transparent;color:${fg};border:1px solid ${fg};border-radius:6px;cursor:pointer;">Закрыть</button>
    </div>`
  if (root) root.innerHTML = html
  else document.body.innerHTML = html
}

// Глобальные обработчики только для popout — в главном окне не трогаем,
// чтобы не мешать normal React error boundary.
if (isPopout) {
  window.addEventListener('error', (e) => {
    renderFatalError(`${e.message || 'unknown'}\n${e.filename || ''}:${e.lineno || '?'}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    renderFatalError(`Unhandled: ${String(e.reason)}`)
  })
}

try {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('#root element not found')
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      {isPopout ? <PopoutRoot /> : <App />}
    </React.StrictMode>
  )
} catch (e: any) {
  renderFatalError(`React mount failed: ${e?.message || e}`)
}
