import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './styles/beast.css'
import { installGlobalDeepLinkHandler } from './mobileAuth'

// Register the appUrlOpen listener at startup so OAuth deep-links
// (com.discryptobank.app://auth?dcb_token=...) are captured even before
// any login-button handler attaches its own listener.
installGlobalDeepLinkHandler()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
