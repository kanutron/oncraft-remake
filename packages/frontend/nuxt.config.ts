export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
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
