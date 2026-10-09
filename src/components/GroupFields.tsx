import { useId, useState } from 'react';
import type { GuideGroup } from '../bridge';

export default function GroupFields({ groups, category: initialCategory, section: initialSection = '' }: { groups: GuideGroup[]; category: string; section?: string }) {
  const id = useId();
  const categories = groups.filter((group) => group.kind === 'category');
  const [category, setCategory] = useState(initialCategory);
  const [section, setSection] = useState(initialSection);
  const parent = categories.find((group) => group.name === category);
  const sections = groups.filter((group) => group.parentId === parent?.id);
  return <>
    <label htmlFor={`${id}-category`}>Category<select id={`${id}-category`} name="category" value={category} required onChange={(event) => { setCategory(event.target.value); setSection(''); }}>
      <option value="" disabled>Choose a category</option>
      {categories.map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}
    </select></label>
    <label htmlFor={`${id}-section`}>Section<select id={`${id}-section`} name="section" value={section} onChange={(event) => setSection(event.target.value)}>
      <option value="">No section</option>
      {sections.map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}
    </select></label>
  </>;
}
