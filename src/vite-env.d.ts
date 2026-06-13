/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Telegram Analytics — optional; analytics is disabled when unset.
  readonly VITE_TGA_TOKEN?: string;
  readonly VITE_TGA_APP_NAME?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
