/*
 * GitHub Repo Manager
 * React entry point and theme wiring
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import './design-system.css'
import App from './App.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
)
