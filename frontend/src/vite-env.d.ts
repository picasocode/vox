/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full origin of a separately deployed backend, e.g. https://vox-api.vercel.app */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
