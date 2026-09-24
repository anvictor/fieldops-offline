import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { OnlineStatusProvider } from './contexts/OnlineStatusProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OnlineStatusProvider>
      <App />
    </OnlineStatusProvider>
  </StrictMode>,
)
