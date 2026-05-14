export {};

declare global {
  interface Window {
    __panelHashListenerBound?: boolean;
    CSRF_TOKEN: string;
  }
}
