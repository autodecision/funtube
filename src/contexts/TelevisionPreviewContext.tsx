import { createContext, useContext, useState, type ReactNode } from 'react';

export type TelevisionPreview = {
  id: string;
  channelId: number;
  title: string;
  thumbnail: string;
  url: string;
  time: string;
  publishedAt?: string;
  description?: string;
  platform: string;
  creatorName: string;
  channelNumber: string;
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
