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
  if (publishedAt) {
    const timestamp = Date.parse(publishedAt);
    if (!isNaN(timestamp)) {
      if (time && time.includes('approx')) return time;
      return new Date(timestamp).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
    }
  }
  return time || 'On demand';
}

