async function revokeTranslationOrigin(permissions, origin) {
  if (!origin) return;
  const permission = { origins: [origin] };
  if (!await permissions.contains(permission)) return;
  if (!await permissions.remove(permission)) {
    throw new Error("无法撤销旧的翻译 API 权限");
  }
}

async function rollbackNewOrigin(permissions, origin) {
  try {
    const permission = { origins: [origin] };
    if (!await permissions.contains(permission)) return;
    if (!await permissions.remove(permission)) {
      throw new Error("无法回收新的翻译 API 权限");
    }
  } catch (error) {
    if (error.message === "无法回收新的翻译 API 权限") throw error;
    throw new Error("无法回收新的翻译 API 权限", { cause: error });
  }
}

export async function saveTranslationSettings({
  storage,
  permissions,
  stored,
  config,
  values,
}) {
  const newPermission = { origins: [config.origin] };
  const permissionExisted = await permissions.contains(newPermission);
  if (!permissionExisted && !await permissions.request(newPermission)) {
    throw new Error("未授权访问翻译 API");
  }

  try {
    const oldOrigin = stored.fullTranscriptTranslationOrigin;
    if (oldOrigin && oldOrigin !== config.origin) {
      await revokeTranslationOrigin(permissions, oldOrigin);
    }
    await storage.set(values);
  } catch (error) {
    if (!permissionExisted) await rollbackNewOrigin(permissions, config.origin);
    throw error;
  }
}

export async function clearTranslationSettings({ storage, permissions, stored, keys }) {
  await revokeTranslationOrigin(permissions, stored.fullTranscriptTranslationOrigin);
  await storage.remove(keys);
}
