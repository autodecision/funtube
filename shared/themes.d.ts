export interface ThemeInfo {
  id: string;
  name: string;
  description: string;
  isDefault?: boolean;
}

export declare const THEMES: ThemeInfo[];
export declare const VALID_THEME_IDS: Set<string>;
export declare function normalizeTheme(value: unknown): string;
