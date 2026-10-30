import { defineConfig } from 'orval'

// Generates typed fetch functions and TanStack Query hooks from the backend OpenAPI schema.
// Regenerate with `npm run api:generate` after any backend API change.
export default defineConfig({
  api: {
    input: './openapi.json',
    output: {
      mode: 'single',
      target: './src/api/generated/api.ts',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: { path: './src/api/http.ts', name: 'apiFetch' },
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
})
