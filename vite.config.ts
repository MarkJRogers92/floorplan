import { defineConfig } from 'vite'
import { readService } from './src/api/service'
import { createServiceHandler } from './src/dev/service-route'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'floorplan-service',
      configureServer(server) {
        // Development aid: the browser cannot read the OpenCode service file, so Vite
        // serves its contents to our own page at /__service. A shippable build will need
        // a real credential path instead of this route.
        server.middlewares.use('/__service', createServiceHandler(readService))
      },
    },
  ],
})
