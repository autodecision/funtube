export const CATEGORY_ORDER = [
  'Science & Learning',
  'Technology',
  'Nature & Outdoors',
  'Food & Cooking',
  'Art & Creativity',
  'Entertainment',
];

export const SECTION_ORDER: Record<string, string[]> = {
  'Science & Learning': ['Experiments', 'Math', 'Space'],
  Technology: ['Reviews', 'Making'],
  'Nature & Outdoors': ['Wildlife', 'Making', 'Restoration', 'Fishing'],
  'Food & Cooking': ['Recipes', 'Baking'],
  'Art & Creativity': ['Painting', 'Drawing', 'Digital Art'],
};

export function formatVideoDate(time?: string, publishedAt?: string): string {
  const cleanTime = time ? time.replace(/\s*\(approx\.?\)/gi, '').trim() : '';
  if (publishedAt) {
    const timestamp = Date.parse(publishedAt);
    if (!isNaN(timestamp)) {
      if (cleanTime && (cleanTime.includes('ago') || /^\d{4}-\d{2}$/.test(cleanTime))) return cleanTime;
      return new Date(timestamp).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
    }
  }
  return cleanTime || 'On demand';
}

export function getCategoryChannelBase(categoryName: string, categoryNames: string[] = CATEGORY_ORDER): number {
  const idx = categoryNames.indexOf(categoryName);
  return idx === -1 ? 0 : idx * 100;
}

export function formatChannelNumber(base: number, offset: number): string {
  const number = base === 0 ? offset + 1 : base + offset;
  return String(number).padStart(4, '0');
}
