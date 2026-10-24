/** Typy dla scripts/serve-dist.mjs (używany w testach e2e: tests/e2e). */
export interface DistServerHooks {
  /** Zmiana treści `sw.js` (symulacja nowej wersji Service Workera). */
  transformSw: ((text: string) => string) | null;
  /** Wymuszony kod odpowiedzi dla ścieżki względem `base` albo `null`. */
  fail: ((pathRel: string) => number | null) | null;
  /** Zrywanie połączeń (brak sieci po stronie serwera). */
  offline: boolean;
  /** Inny katalog buildu serwowany pod tym samym adresem (wdrożenie nowej wersji) albo `null` = `dist` z opcji. */
  dist: string | null;
  /** Opóźnienie odpowiedzi (ms) dla ścieżki względem `base` albo `null`. */
  delay: ((pathRel: string) => number | null) | null;
}

export interface DistServer {
  url: string;
  port: number;
  base: string;
  hooks: DistServerHooks;
  /** Ścieżki żądań względem `base`. */
  requests: string[];
  close(): Promise<void>;
}

export function startDistServer(options: { dist: string; base: string; port?: number; host?: string }): Promise<DistServer>;
