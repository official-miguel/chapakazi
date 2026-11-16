import { defineConfig } from 'vitest/config'

// Tests for the app (src) and for the server functions' plain helpers (../supabase/functions).
export default defineConfig({
  test: {
    dir: '..',
    include: ['app/src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
})
