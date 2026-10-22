import { useEffect, useState } from 'react';
import { loadCover } from '../lib/util';
import { Icon } from './Icon';

/** Album art with a glassy placeholder. Loads lazily and is cached in util.loadCover. */
export function Cover({ path, size, radius = 12 }: { path: string | null; size: number; radius?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) {
      void loadCover(path).then((u) => {
        if (alive) setUrl(u);
      });
    }
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <div className="cover" style={{ width: size, height: size, borderRadius: radius }}>
      {url ? <img src={url} alt="" draggable={false} /> : <Icon name="music" size={Math.round(size * 0.4)} />}
    </div>
  );
}
