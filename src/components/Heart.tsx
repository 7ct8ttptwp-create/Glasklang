import { useExtras } from '../lib/extras';
import { Icon } from './Icon';

/** Heart toggle for one song (identified by its file path). */
export function HeartButton({ path, size = 18 }: { path: string | null | undefined; size?: number }) {
  const fav = useExtras((s) => !!path && s.favs.includes(path));
  const toggle = useExtras((s) => s.toggleFav);
  return (
    <button
      className={`icon-btn heart${fav ? ' on' : ''}`}
      title={fav ? 'Remove from favorites' : 'Add to favorites'}
      disabled={!path}
      onClick={() => path && toggle(path)}
    >
      <Icon name={fav ? 'heartFill' : 'heart'} size={size} />
    </button>
  );
}
