import { useState } from 'react';
import { api, Track } from '../lib/api';
import { useStore } from '../lib/store';

/** Ask how a song should be removed: only from the library, or its file to the Recycle Bin too. */
export function RemoveDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const reload = useStore((s) => s.reloadTracks);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const go = async (deleteFile: boolean) => {
    setBusy(true);
    try {
      await api.removeTracks([track.path], deleteFile);
      await reload();
      toast(deleteFile ? `Moved "${track.title}" to the Recycle Bin` : `Removed "${track.title}" from the library`);
      onClose();
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''), 'error');
      setBusy(false);
    }
  };

  return (
    <>
      <div className="menu-backdrop" onClick={busy ? undefined : onClose} />
      <div className="confirm glass" role="dialog" aria-label="Remove song">
        <h2>Remove song</h2>
        <p className="confirm-song">
          <b>{track.title}</b>
          <br />
          <small>{track.artist}</small>
        </p>
        <div className="confirm-actions">
          <button className="btn" disabled={busy} onClick={() => void go(false)}>
            Remove from library
            <small>The file stays on your computer</small>
          </button>
          <button className="btn danger" disabled={busy} onClick={() => void go(true)}>
            Move file to Recycle Bin
            <small>You can restore it from the Recycle Bin</small>
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
