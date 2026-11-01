import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import manifest from '../manifest.json'
import './index.css'
import App from './App.tsx'

declare global {
  interface Window {
    __agrune_manifest__?: unknown
    __agrune_quick_mode__?: {
      reloadRuntime?: () => void
    }
  }
}

window.__agrune_manifest__ = manifest
window.__agrune_quick_mode__?.reloadRuntime?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
