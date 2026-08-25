import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // ⚠️ ВЕНДОР ОТДЕЛЬНО ОТ КОДА ПРИЛОЖЕНИЯ, и это про ПОВТОРНЫЕ заходы.
        // Раньше React, роутер и клиент базы лежали в одном файле с экранами:
        // любая правка одной строки в приложении меняла хэш всего файла, и
        // игрок скачивал 700 КБ заново — включая React, который не менялся
        // месяцами. Теперь вендор живёт своим файлом с долгим кэшем, а
        // выкатка трогает только код приложения.
        //
        // Заодно браузер тянет их ПАРАЛЛЕЛЬНО, а не одним куском.
        //
        // Делим по трём настоящим границам, а не «всё из node_modules в одну
        // кучу»: вендорный монофайл кэшируется как целое, и обновление любой
        // одной библиотеки снова обесценивало бы весь кэш.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase') || id.includes('/phoenix/')) return 'vendor-supabase';
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'vendor-motion';
          }
          if (id.includes('react-router') || id.includes('@remix-run')) return 'vendor-router';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
