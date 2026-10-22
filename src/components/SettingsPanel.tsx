import { ReactNode, useEffect, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { api, fileUrl } from '../lib/api';
import { EQ_LABELS } from '../lib/audio';
import { BgKind, DEFAULT_THEME, GRADIENT_PRESETS, Preset, themeOf, ThemeData } from '../lib/settings';
import { useStore } from '../lib/store';
import { basename } from '../lib/util';
import { ExtrasSettings } from './Extras';
import { Icon } from './Icon';
import { RangeGlass } from './PlayerBar';

type Tab = 'look' | 'background' | 'audio' | 'library' | 'about';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const { label, value, min, max, step = 1, unit = '', onChange } = props;
  return (
    <Field label={label} hint={`${Math.round(value * 100) / 100}${unit}`}>
      <RangeGlass value={value - min} max={max - min} step={step} label={label} onInput={(v) => onChange(v + min)} />
    </Field>
  );
}

function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (b: boolean) => void; hint?: string }) {
  return (
    <label className="switch-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const applyTheme = useStore((s) => s.applyTheme);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<Tab>('look');

  const { glass, bg } = settings;
  const setGlass = (p: Partial<typeof glass>) => update({ glass: { ...glass, ...p } });
  const setBg = (p: Partial<typeof bg>) => update({ bg: { ...bg, ...p } });

  // ---- background pickers ----
  const pickImage = async () => {
    const f = await open({ multiple: false, title: 'Choose a background image', filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }] });
    if (!f || Array.isArray(f)) return;
    try {
      const dest = await api.importBackground(f);
      setBg({ kind: 'image', value: dest });
    } catch (e) {
      toast(`Could not use that image: ${String(e)}`, 'error');
    }
  };
  const pickVideo = async () => {
    const f = await open({ multiple: false, title: 'Choose a background video', filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'm4v'] }] });
    if (!f || Array.isArray(f)) return;
    try {
      const dest = await api.importBackground(f);
      setBg({ kind: 'video', value: dest });
    } catch (e) {
      toast(`Could not use that video: ${String(e)}`, 'error');
    }
  };
  const pickFolder = async () => {
    const f = await open({ directory: true, multiple: false, title: 'Choose a folder of images' });
    if (!f || Array.isArray(f)) return;
    setBg({ kind: 'slideshow', value: f });
  };

  // ---- presets ----
  const [presetName, setPresetName] = useState('');
  const savePreset = () => {
    const name = presetName.trim() || `Theme ${settings.presets.length + 1}`;
    const preset: Preset = { name, data: JSON.parse(JSON.stringify(themeOf(settings))) as ThemeData };
    update({ presets: [...settings.presets.filter((p) => p.name !== name), preset] });
    setPresetName('');
    toast(`Saved theme "${name}".`);
  };

  const exportTheme = async () => {
    const dest = await save({ title: 'Export theme', defaultPath: 'my-theme.glasklang-theme.json', filters: [{ name: 'Glasklang theme', extensions: ['json'] }] });
    if (!dest) return;
    try {
      const data = themeOf(settings);
      let bgFile: { name: string; data: string } | null = null;
      if ((data.bg.kind === 'image' || data.bg.kind === 'video') && data.bg.value) {
        try {
          bgFile = { name: basename(data.bg.value), data: await api.fileToBase64(data.bg.value) };
        } catch {
          toast('The background is larger than 40 MB, so it is not included in the theme file.', 'error');
        }
      }
      await api.writeTextFile(dest, JSON.stringify({ glasklangTheme: 1, theme: data, bgFile }, null, 2));
      toast('Theme exported.');
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error');
    }
  };

  const importTheme = async () => {
    const f = await open({ multiple: false, title: 'Import theme', filters: [{ name: 'Glasklang theme', extensions: ['json'] }] });
    if (!f || Array.isArray(f)) return;
    try {
      const parsed = JSON.parse(await api.readTextFile(f)) as { glasklangTheme?: number; theme?: ThemeData; bgFile?: { name: string; data: string } | null };
      if (!parsed.glasklangTheme || !parsed.theme) throw new Error('not a Glasklang theme file');
      const theme = parsed.theme;
      if (parsed.bgFile) theme.bg = { ...theme.bg, value: await api.importBackgroundB64(parsed.bgFile.name, parsed.bgFile.data) };
      applyTheme(theme);
      toast('Theme imported.');
    } catch (e) {
      toast(`Import failed: ${String(e)}`, 'error');
    }
  };

  const kinds: { id: BgKind; label: string }[] = [
    { id: 'gradient', label: 'Gradient' },
    { id: 'color', label: 'Color' },
    { id: 'image', label: 'Image / GIF' },
    { id: 'video', label: 'Video' },
    { id: 'slideshow', label: 'Slideshow' },
    { id: 'album', label: 'Album art' },
  ];

  return (
    <aside className="settings glass" role="dialog" aria-label="Settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <button className="icon-btn" onClick={() => setOpen(false)} title="Close">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="tabs">
        {(['look', 'background', 'audio', 'library', 'about'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'look' ? 'Look' : t === 'background' ? 'Background' : t === 'audio' ? 'Audio' : t === 'library' ? 'Library' : 'Privacy'}
          </button>
        ))}
      </div>

      <div className="settings-body">
        {tab === 'look' && (
          <>
            <div className="row">
              <button
                className="btn small"
                title="Puts theme, accent, glass and background back to how they were at the start. Saved themes and audio settings are kept."
                onClick={() => {
                  applyTheme({ ...DEFAULT_THEME, glass: { ...DEFAULT_THEME.glass }, bg: { ...DEFAULT_THEME.bg } });
                  toast('Look reset to default');
                }}
              >
                <Icon name="refresh" size={15} /> Reset look to default
              </button>
            </div>
            <ExtrasSettings />
            <Field label="Theme">
              <div className="seg">
                {(['auto', 'light', 'dark'] as const).map((m) => (
                  <button key={m} className={settings.theme === m ? 'active' : ''} onClick={() => update({ theme: m })}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Accent color" hint={settings.accent ?? 'Windows accent'}>
              <div className="row">
                <input type="color" value={settings.accent ?? '#7aa2ff'} onChange={(e) => update({ accent: e.target.value })} aria-label="Accent color" />
                <button className="btn small" onClick={() => update({ accent: null })}>Use Windows accent</button>
              </div>
            </Field>
            <Switch label="Tint with album art" hint="Accent follows the current cover (when no custom accent is set)" checked={settings.useAlbumTint} onChange={(b) => update({ useAlbumTint: b })} />
            <Switch label="Auto contrast" hint="Keeps text readable on bright or dark backgrounds" checked={settings.autoContrast} onChange={(b) => update({ autoContrast: b })} />

            <h3>Glass</h3>
            <Field label="Quality">
              <div className="seg">
                <button className={glass.quality === 'frosted' ? 'active' : ''} onClick={() => setGlass({ quality: 'frosted' })}>Frosted</button>
                <button className={glass.quality === 'refraction' ? 'active' : ''} onClick={() => setGlass({ quality: 'refraction' })}>Refraction (experimental)</button>
              </div>
            </Field>
            <Slider label="Blur" value={glass.blur} min={0} max={60} unit=" px" onChange={(v) => setGlass({ blur: v })} />
            <Slider label="Color saturation" value={glass.saturation} min={100} max={250} unit="%" onChange={(v) => setGlass({ saturation: v })} />
            <Slider label="Glass intensity" value={glass.intensity} min={0} max={100} unit="%" onChange={(v) => setGlass({ intensity: v })} />

            <h3>Saved themes</h3>
            <div className="row">
              <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name for this look" />
              <button className="btn primary small" onClick={savePreset}>Save</button>
            </div>
            <div className="preset-list">
              {settings.presets.length === 0 && <div className="muted">No saved themes yet.</div>}
              {settings.presets.map((p) => (
                <div className="preset" key={p.name}>
                  <button className="btn small" onClick={() => applyTheme(p.data)}>{p.name}</button>
                  <button className="icon-btn" title="Delete" onClick={() => update({ presets: settings.presets.filter((x) => x.name !== p.name) })}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
            <div className="row">
              <button className="btn small" onClick={() => void exportTheme()}><Icon name="upload" size={15} /> Export theme file</button>
              <button className="btn small" onClick={() => void importTheme()}><Icon name="download" size={15} /> Import theme file</button>
            </div>
          </>
        )}

        {tab === 'background' && (
          <>
            <div className="seg wrap">
              {kinds.map((k) => (
                <button key={k.id} className={bg.kind === k.id ? 'active' : ''} onClick={() => setBg({ kind: k.id })}>
                  {k.label}
                </button>
              ))}
            </div>

            {bg.kind === 'gradient' && (
              <div className="swatches">
                {GRADIENT_PRESETS.map((g) => (
                  <button key={g.name} className={`swatch${bg.value === g.value ? ' active' : ''}`} style={{ background: g.value }} title={g.name} onClick={() => setBg({ value: g.value })}>
                    <span>{g.name}</span>
                  </button>
                ))}
              </div>
            )}
            {bg.kind === 'color' && (
              <Field label="Color">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(bg.value) ? bg.value : '#1b2233'} onChange={(e) => setBg({ value: e.target.value })} aria-label="Background color" />
              </Field>
            )}
            {bg.kind === 'image' && (
              <Field label="Image or GIF" hint={bg.value ? basename(bg.value) : 'none chosen'}>
                <div className="row">
                  <button className="btn small" onClick={() => void pickImage()}>Choose file...</button>
                  {bg.value && bg.kind === 'image' && <img className="thumb" src={fileUrl(bg.value)} alt="" />}
                </div>
              </Field>
            )}
            {bg.kind === 'video' && (
              <Field label="Video (muted, loops)" hint={bg.value ? basename(bg.value) : 'none chosen'}>
                <button className="btn small" onClick={() => void pickVideo()}>Choose file...</button>
              </Field>
            )}
            {bg.kind === 'slideshow' && (
              <>
                <Field label="Image folder" hint={bg.value ? basename(bg.value) : 'none chosen'}>
                  <button className="btn small" onClick={() => void pickFolder()}>Choose folder...</button>
                </Field>
                <Slider label="Change every" value={bg.interval} min={5} max={300} step={5} unit=" s" onChange={(v) => setBg({ interval: v })} />
              </>
            )}
            {bg.kind === 'album' && <div className="muted">The background follows the cover of the song that is playing.</div>}

            {(bg.kind === 'image' || bg.kind === 'video' || bg.kind === 'slideshow') && (
              <Field label="Fit">
                <div className="seg">
                  {(['cover', 'contain', 'fill'] as const).map((f) => (
                    <button key={f} className={bg.fit === f ? 'active' : ''} onClick={() => setBg({ fit: f })}>
                      {f === 'cover' ? 'Fill' : f === 'contain' ? 'Fit' : 'Stretch'}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Slider label="Blur" value={bg.blur} min={0} max={40} unit=" px" onChange={(v) => setBg({ blur: v })} />
            <Slider label="Brightness" value={bg.brightness} min={40} max={160} unit="%" onChange={(v) => setBg({ brightness: v })} />
            <Field label="Tint color">
              <input type="color" value={bg.tint} onChange={(e) => setBg({ tint: e.target.value })} aria-label="Tint color" />
            </Field>
            <Slider label="Tint strength" value={bg.tintOpacity} min={0} max={80} unit="%" onChange={(v) => setBg({ tintOpacity: v })} />
          </>
        )}

        {tab === 'audio' && (
          <>
            <Switch label="Equalizer" checked={settings.eqEnabled} onChange={(b) => update({ eqEnabled: b })} />
            <div className={`eq${settings.eqEnabled ? '' : ' off'}`}>
              {EQ_LABELS.map((label, i) => (
                <Slider
                  key={label}
                  label={label}
                  value={settings.eqGains[i]}
                  min={-12}
                  max={12}
                  step={0.5}
                  unit=" dB"
                  onChange={(v) => {
                    const g = settings.eqGains.slice();
                    g[i] = v;
                    update({ eqGains: g });
                  }}
                />
              ))}
            </div>
            <button className="btn small" onClick={() => update({ eqGains: [0, 0, 0, 0, 0] })}>Reset equalizer</button>
            <Slider label="Playback speed" value={settings.speed} min={0.5} max={2} step={0.05} unit="x" onChange={(v) => update({ speed: v })} />
            <h3>Windows</h3>
            <Switch label="Hide to tray when closing" hint="The close button hides the window; quit from the tray icon" checked={settings.closeToTray} onChange={(b) => update({ closeToTray: b })} />
            <Switch label="Force media keys" hint="Turn on only if your keyboard media keys do not work. Registers them globally." checked={settings.forceMediaKeys} onChange={(b) => update({ forceMediaKeys: b })} />
          </>
        )}

        {tab === 'library' && <LibraryTab />}

        {tab === 'about' && (
          <>
            <h3>Private by design</h3>
            <ul className="plain">
              <li>Works 100% offline. No accounts, no telemetry, no analytics, no update checks.</li>
              <li>The app has no network code, and its security policy blocks outgoing connections.</li>
              <li>Cover art and tags are read from your own files only. No online lookups.</li>
              <li>Your library, settings and themes live in one local folder you can open and delete.</li>
            </ul>
            <p className="muted">Glasklang 0.1.0 - MIT license.</p>
          </>
        )}
      </div>
    </aside>
  );
}

function LibraryTab() {
  const tracks = useStore((s) => s.tracks);
  const addFolderDialog = useStore((s) => s.addFolderDialog);
  const rescan = useStore((s) => s.rescan);
  const reloadTracks = useStore((s) => s.reloadTracks);
  const scanning = useStore((s) => s.scanning);
  const toast = useStore((s) => s.toast);
  const [folders, setFolders] = useState<string[]>([]);
  const [dataDir, setDataDir] = useState('');
  const [confirm, setConfirm] = useState(false);

  const refresh = () => void api.listFolders().then(setFolders).catch(() => undefined);
  useEffect(() => {
    refresh();
    void api.dataDirPath().then(setDataDir).catch(() => undefined);
  }, [tracks.length]);

  const wipe = async () => {
    try {
      await api.deleteAllData();
      toast('All Glasklang data was deleted. Restarting the view...');
      window.setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast(`Could not delete data: ${String(e)}`, 'error');
    }
  };

  return (
    <>
      <h3>Music folders</h3>
      <div className="folder-list">
        {folders.length === 0 && <div className="muted">No folders added. Files dropped in one by one are not listed here.</div>}
        {folders.map((f) => (
          <div className="folder" key={f}>
            <span title={f}>{f}</span>
            <button
              className="icon-btn"
              title="Remove folder from library (your files are not touched)"
              onClick={() => void api.removeFolder(f).then(async () => { await reloadTracks(); refresh(); })}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn small" onClick={() => void addFolderDialog()}><Icon name="folderPlus" size={15} /> Add folder</button>
        <button className="btn small" disabled={scanning} onClick={() => void rescan()}><Icon name="refresh" size={15} /> Rescan now</button>
      </div>
      <p className="muted">{tracks.length.toLocaleString()} songs in the library.</p>

      <h3>Your data</h3>
      <p className="muted break">{dataDir}</p>
      <div className="row">
        <button className="btn small" onClick={() => void api.openDataDir()}>Open data folder</button>
      </div>
      <p className="muted">Crash log: crash.log in that folder (never sent anywhere).</p>
      <button className={`btn small danger${confirm ? ' armed' : ''}`} onClick={() => (confirm ? void wipe() : setConfirm(true))}>
        {confirm ? 'Click again to delete everything' : 'Delete all app data'}
      </button>
    </>
  );
}
