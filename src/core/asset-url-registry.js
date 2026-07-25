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

export async function loadNoteAssets(note, { getAsset, registry }) {
  const result = { screenshotUrl: "", audioUrl: "", warnings: [] };
  const load = async (key, field, warning) => {
    if (!key) return;
    const blob = await getAsset(key);
    if (!blob) {
      result.warnings.push(warning);
      return;
    }
    result[field] = registry.set(key, blob);
  };
  await Promise.all([
    load(note.screenshotKey, "screenshotUrl", "截图资产缺失"),
    load(note.audioKey, "audioUrl", "录音资产缺失"),
  ]);
  return result;
}
