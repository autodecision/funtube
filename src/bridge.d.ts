export type Channel = {
  id: number; name: string; platform: string; avatar: string; url: string;
  category: string; section: string; position: number; enabled: number;
};
type Creator = {
  channelId: number; name: string; platform: string; avatar: string;
  videos: { id: string; title: string; thumbnail: string; time: string; url: string }[];
};
export type FeedSettings = { youtube: boolean; firecrawl: boolean };

declare global {
  interface Window {
    funtube: {
      channels(): Promise<{ channels: Channel[] }>;
      feed(ids: number[]): Promise<{ creators: Creator[]; warnings: string[] }>;
      settings(): Promise<FeedSettings>;
      saveKeys(keys: { youtube?: string; firecrawl?: string }): Promise<FeedSettings>;
      allChannels(): Promise<Channel[]>;
      addChannel(input: { url: string; category: string; section: string }): Promise<{ channels: Channel[] }>;
      updateChannel(input: { id: number; enabled: boolean; category: string; section: string }): Promise<Channel[]>;
      removeChannel(id: number): Promise<Channel[]>;
    };
  }
}
