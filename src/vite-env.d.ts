/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Overrides where the .pmtiles files are read from. See TILES_BASE in config.ts.
  readonly VITE_TILES_BASE?: string;
  // Where the two on-demand APIs are. See ondemandApi.ts.
  readonly VITE_FI_API_BASE?: string;
  readonly VITE_ROUTES_API_BASE?: string;
  // The localhost access code, read only by the dev server from
  // .env.development.local. Never set it for a production build.
  readonly VITE_ONDEMAND_LOCAL_CODE?: string;
  // The alternate routes tool's own localhost code, read the same way.
  readonly VITE_ROUTES_LOCAL_CODE?: string;
  // "1" at build time shows the two on-demand tools in a production build.
  // Without it they are left out, since the APIs are not online yet.
  readonly VITE_ONDEMAND_LIVE?: string;
}
