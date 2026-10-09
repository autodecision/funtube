const section = (name, icon) => ({ name, icon });
const preset = (name, label, icon, sections) => ({ name, label, icon, sections });

export const CATEGORY_PRESETS = [
  preset('Science & Learning', 'Science', 'atom', [section('Experiments', 'flask'), section('Math', 'math'), section('Space', 'rocket'), section('Learning', 'book')]),
  preset('Technology', 'Technology', 'monitor', [section('Reviews', 'reviews'), section('Making', 'solder'), section('Programming', 'code'), section('Networking', 'network')]),
  preset('Nature & Outdoors', 'Nature', 'tree', [section('Wildlife', 'paw'), section('Making', 'cabin'), section('Restoration', 'restore'), section('Fishing', 'fish')]),
  preset('Food & Cooking', 'Cooking', 'chef', [section('Recipes', 'pot'), section('Baking', 'bread'), section('Kitchen skills', 'knife'), section('Grilling', 'grill')]),
  preset('Art & Creativity', 'Art', 'palette', [section('Painting', 'brush'), section('Drawing', 'pencil'), section('Digital Art', 'tablet'), section('Photography', 'camera')]),
  preset('Entertainment', 'Entertainment', 'reel', [section('Slow Motion', 'slow-motion'), section('Comedy', 'masks'), section('Film & TV', 'clapper'), section('Documentaries', 'documentary')]),
  preset('Gaming', 'Gaming', 'controller', [section('Retro games', 'arcade'), section('Esports', 'trophy'), section('Tabletop', 'dice'), section('Game development', 'game-design')]),
  preset('Music', 'Music', 'headphones', [section('Instruments', 'guitar'), section('Live performances', 'microphone'), section('Music production', 'mixer'), section('Music theory', 'notes')]),
  preset('Sports', 'Sports', 'ball', [section('Team sports', 'whistle'), section('Cycling', 'bike'), section('Adventure sports', 'mountain'), section('Running', 'runner')]),
  preset('Health & Wellness', 'Health', 'heart', [section('Fitness', 'dumbbell'), section('Mindfulness', 'lotus'), section('Nutrition', 'apple'), section('Sleep', 'moon')]),
  preset('Travel', 'Travel', 'globe', [section('Cities', 'city'), section('Exploring', 'compass'), section('Road trips', 'van'), section('Travel tips', 'suitcase')]),
  preset('Home & Garden', 'Home', 'house', [section('DIY', 'hammer'), section('Gardening', 'sprout'), section('Interior design', 'sofa'), section('Organization', 'basket')]),
  preset('Business & Finance', 'Business', 'briefcase', [section('Personal finance', 'chart'), section('Investing', 'coins'), section('Entrepreneurship', 'lightbulb'), section('Careers', 'handshake')]),
  preset('History & Culture', 'History', 'scroll', [section('Ancient history', 'ruins'), section('Modern history', 'landmark'), section('Languages', 'languages'), section('World cultures', 'museum')]),
  preset('News & Ideas', 'Ideas', 'chat', [section('Current events', 'newspaper'), section('Policy & society', 'balance'), section('Philosophy', 'brain'), section('Interviews', 'podcast')]),
  preset('Automotive', 'Automotive', 'steering', [section('Cars', 'car'), section('Maintenance', 'wrench'), section('Motorcycles', 'motorbike'), section('Engines', 'engine')]),
];

export function suggestedIcon(category, sectionName = '') {
  const categoryPreset = CATEGORY_PRESETS.find((entry) => entry.name.toLowerCase() === category.toLowerCase());
  return (sectionName ? categoryPreset?.sections.find((entry) => entry.name.toLowerCase() === sectionName.toLowerCase())?.icon : categoryPreset?.icon) || 'folder';
}
