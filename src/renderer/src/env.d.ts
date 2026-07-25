/// <reference types="vite/client" />

import type { CardVaultApi } from '../../preload/index'

declare global {
  interface Window {
    api: CardVaultApi
  }
}

export {}
