export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  ssr: false,
  devtools: { enabled: true },
  devServer: {
    port: 3100,
  },
  runtimeConfig: {
    public: {
      backendUrl: 'http://localhost:3101',
      wsUrl: 'ws://localhost:3101/ws',
    },
  },
})
