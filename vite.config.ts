import { defineConfig } from 'vite'
import { readService } from './src/api/service'
import { createServiceHandler } from './src/dev/service-route'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Development aid: the browser cannot read the OpenCode service file, so the Vite
    // process serves its contents to our own page at /__service. A shippable build will
    // need a real credential path instead of this route.
    middleware: [
      {
        name: 'floorplan-service',
        configureServer(server) {
          server.middlewares.use('/__service', createServiceHandler(readService))
        },
      },
    ],
  },
})
