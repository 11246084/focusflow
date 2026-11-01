import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AdminApp from './AdminApp.jsx'
import LineCallback from './pages/LineCallback.jsx'

const { pathname } = window.location
const isAdminPath = pathname.startsWith('/admin')
const isLineCallback = /^\/line\/callback\/?$/.test(pathname)

function rootPage() {
  if (isLineCallback) return <LineCallback />
  return isAdminPath ? <AdminApp /> : <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {rootPage()}
  </StrictMode>,
)
