/**
 * Vitest setup — polyfill Nuxt auto-imports so store files can be imported
 * without the Nuxt build pipeline.
 */
import { vi } from 'vitest'
import { ref, computed, reactive, toRaw } from 'vue'
import { defineStore, setActivePinia, createPinia } from 'pinia'

/* ── Nuxt auto-imports exposed as globals ─────────────────────────── */

// Vue reactivity
;(globalThis as any).ref = ref
;(globalThis as any).computed = computed
;(globalThis as any).reactive = reactive
;(globalThis as any).toRaw = toRaw

// Pinia
;(globalThis as any).defineStore = defineStore

// $fetch — starts as a no-op; tests override via vi.stubGlobal
;(globalThis as any).$fetch = vi.fn()

// useRuntimeConfig — returns a shape matching nuxt.config.ts
;(globalThis as any).useRuntimeConfig = () => ({
  public: {
    backendUrl: 'http://test:3101',
    wsUrl: 'ws://test:3101/ws',
  },
})

/* ── crypto.randomUUID polyfill (Node < 19 may not expose it on globalThis) */
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto')
  ;(globalThis as any).crypto = webcrypto
}
