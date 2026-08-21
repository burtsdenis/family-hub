/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected at build time by vite.config.ts. */
declare const __APP_VERSION__: string;
/** Short commit of the build; empty when built from source. */
declare const __BUILD_SHA__: string;
