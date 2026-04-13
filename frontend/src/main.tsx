import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'

import './index.css'
import App from './App.tsx'
import { AppAuthProvider } from './auth/AuthProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider
      defaultColorScheme="light"
      theme={{
        fontFamily: 'Inter, system-ui, sans-serif',
        primaryColor: 'teal',
        defaultRadius: 'sm',
      }}
    >
      <Notifications position="top-right" />
      <AppAuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppAuthProvider>
    </MantineProvider>
  </StrictMode>,
)
