import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { api, fileUrl } from './lib/api';
import { useStore } from './lib/store';
import { clamp, gradientLuminance, hexLuminance, imageLuminance } from './lib/util';
import { Background } from './components/Background';
import { GlassFilters } from './components/GlassFilters';
import { PlayerBar } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { AlbumDetail, AlbumsView, ArtistDetail, ArtistsView, PlaylistView, QueueView, SongsView } from './components/Views';

export default function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const settings = useStore((s) => s.settings);
  const view = useStore((s) => s.view);
  const tint = useStore((s) => s.tint);
  const coverUrl = useStore((s) => s.coverUrl);
  const dragging = useStore((s) => s.dragging);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const toasts = useStore((s) => s.toasts);
  const setDragging = useStore((s) => s.setDragging);
  const addPaths = useStore((s) => s.addPaths);

  const [osDark, setOsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [compact, setCompact] = useState(() => window.innerHeight < 230);
  const [lum, setLum] = useState(0.35);

  // ---- start up ----
  useEffect(() => {
    init().catch((e) => void api.logError(`init failed: ${String(e)}`));
  }, [init]);

  // ---- follow Windows light/dark and the window size ----
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => setOsDark(mq.matches);
    const onResize = () => setCompact(window.innerHeight < 230);
    mq.addEventListener('change', onMq);
    window.addEventListener('resize', onResize);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // ---- drag & drop of files and folders from Explorer ----
  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'enter' || p.type === 'over') setDragging(true);
        else if (p.type === 'leave') setDragging(false);
        else if (p.type === 'drop') {
          setDragging(false);
          void addPaths(p.paths);
        }
      })
      .then((f) => {
        un = f;
      })
      .catch(() => undefined);
    return () => un?.();
  }, [setDragging, addPaths]);

  // ---- keyboard: space = play/pause, Ctrl+F = search ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && (el as HTMLInputElement).type !== 'range';
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        useStore.getState().togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- how bright is the background? (drives auto contrast) ----
  const bg = settings.bg;
  useEffect(() => {
    let alive = true;
    const done = (v: number | null) => alive && setLum(v ?? 0.4);
    if (bg.kind === 'gradient') done(gradientLuminance(bg.value));
    else if (bg.kind === 'color') done(hexLuminance(bg.value));
    else if (bg.kind === 'image' && bg.value) void imageLuminance(fileUrl(bg.value)).then(done);
    else if (bg.kind === 'album' && coverUrl) void imageLuminance(coverUrl).then(done);
    else done(0.35);
    return () => {
      alive = false;
    };
  }, [bg.kind, bg.value, coverUrl]);

  // ---- derived look ----
  const effLum = clamp(lum * (bg.brightness / 100), 0, 1) * (1 - bg.tintOpacity / 100) + hexLuminance(bg.tint) * (bg.tintOpacity / 100);
  const theme: 'light' | 'dark' =
    settings.theme === 'auto' ? (settings.autoContrast ? (effLum > 0.62 ? 'light' : 'dark') : osDark ? 'dark' : 'light') : settings.theme;

  const scrim = useMemo(() => {
    if (!settings.autoContrast) return { color: '#000', opacity: 0 };
    if (theme === 'dark') return { color: '#000', opacity: clamp((effLum - 0.5) * 0.9, 0, 0.45) };
    return { color: '#fff', opacity: clamp((0.5 - effLum) * 0.9, 0, 0.45) };
  }, [settings.autoContrast, theme, effLum]);

  const accent = settings.accent ?? (settings.useAlbumTint ? tint : null);
  const style = {
    '--g-blur': `${settings.glass.blur}px`,
    '--g-sat': `${settings.glass.saturation}%`,
    '--g-alpha': ((settings.glass.intensity / 100) * 0.5).toFixed(3),
    ...(accent ? { '--accent': accent } : {}),
  } as CSSProperties;

  let body;
  switch (view.kind) {
    case 'albums':
      body = <AlbumsView />;
      break;
    case 'album':
      body = <AlbumDetail albumKey={view.key} />;
      break;
    case 'artists':
      body = <ArtistsView />;
      break;
    case 'artist':
      body = <ArtistDetail artist={view.artist} />;
      break;
    case 'playlist':
      body = <PlaylistView id={view.id} />;
      break;
    case 'queue':
      body = <QueueView />;
      break;
    default:
      body = <SongsView />;
  }

  return (
    <div className={`app${compact ? ' compact' : ''}`} data-theme={theme} data-quality={settings.glass.quality} style={style}>
      <GlassFilters />
      <Background bg={bg} scrim={scrim} />
      <TitleBar compact={compact} />
      {!compact && (
        <div className="main">
          <Sidebar />
          <section className="content glass">{ready ? body : null}</section>
        </div>
      )}
      <PlayerBar compact={compact} />
      {settingsOpen && !compact && <SettingsPanel />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast glass${t.kind === 'error' ? ' error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
      {dragging && (
        <div className="drop-overlay">
          <div>Drop music files or folders to add them</div>
        </div>
      )}
    </div>
  );
}
