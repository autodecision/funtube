import { createContext, useContext, useState, type ReactNode } from 'react';

// The "now previewing" program from the Television guide. Television sets it on
// hover; the SecondaryInfoBar renders it above the Media-mode toggle. Keeping it
// in context (rather than inside Television) lets the preview live in a sibling
// panel across the layout — the same reason AuthContext exists.
export type TelevisionPreview = {
  title: string;
  thumbnail: string;
  url: string;
  time: string;
  platform: string;
  creatorName: string;
};

type TelevisionPreviewContextValue = {
  preview: TelevisionPreview | null;
  setPreview: (preview: TelevisionPreview | null) => void;
};

const TelevisionPreviewContext = createContext<TelevisionPreviewContextValue | null>(null);

export function TelevisionPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<TelevisionPreview | null>(null);
  return (
    <TelevisionPreviewContext.Provider value={{ preview, setPreview }}>
      {children}
    </TelevisionPreviewContext.Provider>
  );
}

export function useTelevisionPreview() {
  const ctx = useContext(TelevisionPreviewContext);
  if (!ctx) throw new Error('useTelevisionPreview must be used within a TelevisionPreviewProvider');
  return ctx;
}
