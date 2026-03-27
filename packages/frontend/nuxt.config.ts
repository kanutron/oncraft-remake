export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  ssr: false,
  devtools: { enabled: true },
  devServer: {
    port: 3000,
  },
  runtimeConfig: {
    public: {
      backendUrl: 'http://localhost:3001',
      wsUrl: 'ws://localhost:3001/ws',
    },
  },
})
