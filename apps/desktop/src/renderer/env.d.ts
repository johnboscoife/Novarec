/// <reference types="vite/client" />
import type { NovaRecApi } from '../preload/api.js';

declare global {
  interface Window {
    novarec: NovaRecApi;
  }
}

export {};
