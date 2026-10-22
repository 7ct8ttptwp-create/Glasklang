import { getCurrentWindow, LogicalSize, PhysicalSize } from '@tauri-apps/api/window';
import { useStore } from '../lib/store';
import { Icon } from './Icon';

let savedSize: { width: number; height: number } | null = null;

/** Switch between the full window and a small always-on-top mini player. */
export async function toggleMini() {
  const st = useStore.getState();
  const win = getCurrentWindow();
  try {
    if (!st.mini) {
      if (await win.isMaximized()) await win.unmaximize();
      const size = await win.innerSize();
      savedSize = { width: size.width, height: size.height };
      await win.setSize(new LogicalSize(400, 136));
      await win.setAlwaysOnTop(true);
      st.setMini(true);
    } else {
      await win.setAlwaysOnTop(false);
      if (savedSize) await win.setSize(new PhysicalSize(savedSize.width, savedSize.height));
      else await win.setSize(new LogicalSize(1100, 720));
      st.setMini(false);
    }
  } catch (e) {
    st.toast(`Could not resize the window: ${String(e)}`, 'error');
  }
}

export function TitleBar({ compact }: { compact: boolean }) {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const closeToTray = useStore((s) => s.settings.closeToTray);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const mini = useStore((s) => s.mini);
  const win = getCurrentWindow();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="logo" aria-hidden="true" />
        <span data-tauri-drag-region>Glasklang</span>
      </div>

      {!compact && (
        <label className="search glass-soft">
          <Icon name="search" size={16} />
          <input
            id="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search songs, artists, albums"
            spellCheck={false}
          />
          {search && (
            <button className="icon-btn" onClick={() => setSearch('')} title="Clear search">
              <Icon name="x" size={14} />
            </button>
          )}
        </label>
      )}

      <div className="spacer" data-tauri-drag-region />

      <div className="winbtns">
        {!compact && (
          <button className={`icon-btn${settingsOpen ? ' active' : ''}`} title="Appearance and settings" onClick={() => setSettingsOpen(!settingsOpen)}>
            <Icon name="sliders" size={18} />
          </button>
        )}
        <button className={`icon-btn${mini ? ' active' : ''}`} title={mini ? 'Back to full window' : 'Mini player'} onClick={() => void toggleMini()}>
          <Icon name="mini" size={18} />
        </button>
        <button className="icon-btn" title="Minimize" onClick={() => void win.minimize()}>
          <Icon name="minus" size={18} />
        </button>
        {!compact && (
          <button className="icon-btn" title="Maximize" onClick={() => void win.toggleMaximize()}>
            <Icon name="square" size={16} />
          </button>
        )}
        <button
          className="icon-btn close"
          title={closeToTray ? 'Hide to tray' : 'Close'}
          onClick={() => void (closeToTray ? win.hide() : win.close())}
        >
          <Icon name="x" size={18} />
        </button>
      </div>
    </header>
  );
}
