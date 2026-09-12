import { registerSW } from 'virtual:pwa-register'

// autoUpdate mode: a new service worker activates immediately and the page reloads
// once it takes control, so a deploy reaches the phone on the next open rather than
// the one after. Also poll for updates hourly for sessions left open.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    setInterval(() => registration.update(), 60 * 60 * 1000)
  },
})
