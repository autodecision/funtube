import { useEffect, useState } from 'react';
import type { TelevisionPreview } from '../contexts/TelevisionPreviewContext';

const descriptions = new Map<string, string>();

export default function VideoDescription({ preview }: { preview: TelevisionPreview }) {
  const cacheKey = `${preview.channelId}:${preview.id}`;
  const [saved] = useState(() => preview.description ?? descriptions.get(cacheKey));
  const [description, setDescription] = useState(saved || '');
  const [loading, setLoading] = useState(saved === undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (saved !== undefined) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(() => {
      window.funtube.videoDetails({ channelId: preview.channelId, videoId: preview.id }).then((details) => {
        descriptions.set(cacheKey, details.description);
        if (descriptions.size > 200) descriptions.delete(descriptions.keys().next().value!);
        if (!cancelled) setDescription(details.description);
      }).catch(() => { if (!cancelled) setFailed(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [preview.channelId, preview.id, cacheKey, saved, attempt]);

  return <section className="program-description" aria-label="Video description" aria-busy={loading} tabIndex={0}>
    {loading ? <p className="program-description-status" role="status">Loading description…</p> : failed ? <p className="program-description-status" role="status">Couldn’t load this description. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></p> : <p>{description || 'No description is available for this video on the site.'}</p>}
  </section>;
}
