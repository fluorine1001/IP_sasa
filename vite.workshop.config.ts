import { defineConfig } from 'vite';
import { playerStages } from './vite.config';
export default defineConfig({
  plugins: [playerStages()],
  build: {
    outDir: 'dist-workshop',
    rollupOptions: { input: { game: 'index.html', editor: 'editor.html' } },
  },
});
