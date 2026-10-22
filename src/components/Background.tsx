import { ReactElement, useEffect, useState } from 'react';
import { api, fileUrl } from '../lib/api';
import type { BgSettings } from '../lib/settings';
import { useStore } from '../lib/store';

interface Props {
  bg: BgSettings;
  scrim: { color: string; opacity: number };
}

/** The user's background: gradient, color, image/GIF, video, folder slideshow or the current album art. */
export function Background({ bg, scrim }: Props) {
  const coverUrl = useStore((s) => s.coverUrl);
  const [images, setImages] = useState<string[]>([]);
  const [slide, setSlide] = useState(0);

  // Slideshow: list the folder, then rotate.
  useEffect(() => {
    if (bg.kind !== 'slideshow' || !bg.value) {
      setImages([]);
      return;
    }
    let alive = true;
    api
      .listImages(bg.value)
      .then((list) => {
        if (alive) {
          setImages(list);
          setSlide(0);
        }
      })
      .catch(() => alive && setImages([]));
    return () => {
      alive = false;
    };
  }, [bg.kind, bg.value]);

  useEffect(() => {
    if (bg.kind !== 'slideshow' || images.length < 2) return;
    const id = window.setInterval(() => setSlide((i) => (i + 1) % images.length), Math.max(5, bg.interval) * 1000);
    return () => window.clearInterval(id);
  }, [bg.kind, images, bg.interval]);

  // Video: do not burn CPU/GPU while the window is minimized or hidden.
  useEffect(() => {
    const onVis = () => {
      document.querySelectorAll<HTMLVideoElement>('.bg-media video').forEach((v) => {
        if (document.hidden) v.pause();
        else void v.play().catch(() => undefined);
      });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const fit = bg.fit === 'fill' ? 'fill' : bg.fit;
  const mediaStyle = { filter: `blur(${bg.blur}px) brightness(${bg.brightness}%)`, transform: bg.blur > 0 ? 'scale(1.08)' : undefined };

  let media: ReactElement | null = null;
  if (bg.kind === 'gradient') {
    media = <div className="bg-fill" style={{ background: bg.value }} />;
  } else if (bg.kind === 'color') {
    media = <div className="bg-fill" style={{ background: bg.value }} />;
  } else if (bg.kind === 'image' && bg.value) {
    media = <img className="bg-img" src={fileUrl(bg.value)} style={{ objectFit: fit }} alt="" draggable={false} />;
  } else if (bg.kind === 'video' && bg.value) {
    media = <video className="bg-img" src={fileUrl(bg.value)} style={{ objectFit: fit }} autoPlay loop muted playsInline />;
  } else if (bg.kind === 'slideshow' && images.length > 0) {
    media = <img key={images[slide]} className="bg-img fade-in" src={fileUrl(images[slide])} style={{ objectFit: fit }} alt="" draggable={false} />;
  } else if (bg.kind === 'album' && coverUrl) {
    media = <img key={coverUrl} className="bg-img fade-in" src={coverUrl} style={{ objectFit: 'cover' }} alt="" draggable={false} />;
  }

  return (
    <div className="bg-root" aria-hidden="true">
      <div className="bg-media" style={mediaStyle}>
        {media}
      </div>
      <div className="bg-layer" style={{ background: bg.tint, opacity: bg.tintOpacity / 100 }} />
      <div className="bg-layer" style={{ background: scrim.color, opacity: scrim.opacity }} />
    </div>
  );
}
