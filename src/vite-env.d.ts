/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Overrides where the .pmtiles files are read from. See TILES_BASE in config.ts.
  readonly VITE_TILES_BASE?: string;
}
