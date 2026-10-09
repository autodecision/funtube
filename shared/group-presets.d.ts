export type SectionPreset = { name: string; icon: string };
export type CategoryPreset = SectionPreset & { label: string; sections: SectionPreset[] };
export const CATEGORY_PRESETS: CategoryPreset[];
export function suggestedIcon(category: string, sectionName?: string): string;
