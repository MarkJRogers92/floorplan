import { defineConfig, loadEnv } from 'vite'
import { readService } from './src/api/service'
import { createServiceHandler } from './src/dev/service-route'
import { createDirectorHandler } from './src/dev/director-route'
import { createDirectorService, directorConfig } from './src/dev/director-service'
import { createDirectorProvider } from './src/dev/director-provider'
import { createSeriesStore } from './server/series-store'
import { createSeriesHandler } from './src/dev/series-route'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: { host: '127.0.0.1', cors: false },
  plugins: [
    {
      name: 'floorplan-service',
      configureServer(server) {
        // Development aid: the browser cannot read the OpenCode service file, so Vite
        // serves its contents to our own page at /__service. A shippable build will need
        // a real credential path instead of this route.
        server.middlewares.use('/__service', createServiceHandler(readService))
        const config = directorConfig(loadEnv(mode, '.', 'FLOORPLAN_DIRECTOR_'))
        server.middlewares.use('/__director', createDirectorHandler(createDirectorService(config, createDirectorProvider(config.key))))
        server.middlewares.use('/__series', createSeriesHandler(createSeriesStore()))
      },
    },
  ],
}))
