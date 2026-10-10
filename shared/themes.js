export const THEMES = [
  { id: 'blue', name: 'Blue', description: 'Classic retro cathode-ray guide in deep navy and cyan.', isDefault: true },
  { id: 'green', name: 'Green', description: 'Phosphor green CRT glow with jade highlights.' },
  { id: 'red', name: 'Red', description: 'Bold crimson ruby broadcast aesthetic.' },
  { id: 'pink', name: 'Pink', description: 'Radiant neon pink CRT phosphor with soft rose highlights.' },
  { id: 'yellow', name: 'Yellow', description: 'Warm amber monitor phosphor with golden tones.' },
  { id: 'orange', name: 'Orange', description: 'Sunset copper cathode with vibrant amber accents.' },
  { id: 'indigo', name: 'Indigo', description: 'Deep cosmic night sky with vivid electric indigo accents.' },
  { id: 'violet', name: 'Violet', description: 'Electric amethyst neon pulse with brilliant magenta glow.' },
  { id: 'terminal', name: 'Hacker Terminal', description: 'Green phosphor, command prompts, scanlines, and a compact console dock.' },
  { id: 'psychedelic', name: 'Psychedelic Melt', description: 'Liquid rainbow color, dripping panels, and slowly melting organic shapes.' },
];

export const VALID_THEME_IDS = new Set(THEMES.map((t) => t.id));

export function normalizeTheme(value) {
  if (typeof value !== 'string') return 'blue';
  const clean = value.toLowerCase().trim();
  if (clean === 'orage') return 'orange';
  return VALID_THEME_IDS.has(clean) ? clean : 'blue';
}
