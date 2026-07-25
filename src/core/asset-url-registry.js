export function createAssetUrlRegistry({
  createObjectURL = URL.createObjectURL.bind(URL),
  revokeObjectURL = URL.revokeObjectURL.bind(URL),
} = {}) {
  const urls = new Map();
  return {
    set(key, blob) {
      const previous = urls.get(key);
      if (previous) revokeObjectURL(previous);
      const url = createObjectURL(blob);
      urls.set(key, url);
      return url;
    },
    revokeAll() {
      for (const url of urls.values()) revokeObjectURL(url);
      urls.clear();
    },
    get size() {
      return urls.size;
    },
  };
}

export function stopNoteMedia(container) {
  for (const audio of container.querySelectorAll("audio")) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

export async function loadNoteAssets(note, {
  getAsset,
  registry,
  isCurrent = () => true,
  registryKeyPrefix = "",
}) {
  const result = { screenshotUrl: "", audioUrl: "", warnings: [], stale: false };
  const load = async (key, field, warning) => {
    if (!key) return { key, field, warning, blob: null };
    try {
      return { key, field, warning, blob: await getAsset(key) };
    } catch {
      return { key, field, warning, blob: null };
    }
  };
  const assets = await Promise.all([
    load(note.screenshotKey, "screenshotUrl", "截图资产缺失"),
    load(note.audioKey, "audioUrl", "录音资产缺失"),
  ]);
  if (!isCurrent()) {
    result.stale = true;
    return result;
  }
  for (const asset of assets) {
    if (!asset.key) continue;
    if (!asset.blob) {
      result.warnings.push(asset.warning);
      continue;
    }
    const registryKey = registryKeyPrefix ? `${registryKeyPrefix}${asset.field}` : asset.key;
    result[asset.field] = registry.set(registryKey, asset.blob);
  }
  return result;
}
