export type Channel = {
  id: number; name: string; platform: string; avatar: string; url: string;
  category: string; section: string; position: number; enabled: number;
};
type Creator = {
  channelId: number; name: string; platform: string; avatar: string;
  videos: { id: string; title: string; thumbnail: string; time: string; publishedAt?: string; url: string; description?: string }[];
};
export type FeedSettings = { youtube: boolean; firecrawl: boolean };
export type GuideGroup = { id: number; kind: 'category' | 'section'; parentId: number | null; name: string; icon: string; position: number };
export type GroupInput = { id?: number; kind: GuideGroup['kind']; parentId?: number | null; name: string; icon: string };

declare global {
  interface Window {
    funtube: {
      channels(): Promise<{ channels: Channel[] }>;
      feed(ids: number[]): Promise<{ creators: Creator[]; warnings: string[] }>;
      videoDetails(input: { channelId: number; videoId: string }): Promise<{ description: string }>;
      settings(): Promise<FeedSettings>;
      saveKeys(keys: { youtube?: string; firecrawl?: string }): Promise<FeedSettings>;
      allChannels(): Promise<Channel[]>;
      addChannel(input: { url: string; category: string; section: string }): Promise<{ channels: Channel[] }>;
      updateChannel(input: { id: number; enabled: boolean; category: string; section: string }): Promise<Channel[]>;
      removeChannel(id: number): Promise<Channel[]>;
      groups(): Promise<GuideGroup[]>;
      saveGroup(input: GroupInput): Promise<GuideGroup[]>;
      removeGroup(id: number): Promise<GuideGroup[]>;
      addGroupPreset(name: string): Promise<GuideGroup[]>;
      getTheme(): Promise<string>;
      saveTheme(theme: string): Promise<string>;
    };
  }
}
