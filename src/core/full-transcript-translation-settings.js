export const FULL_TRANSCRIPT_TRANSLATION_PENDING_ORIGIN_KEY =
  "fullTranscriptTranslationPendingOrigin";

async function revokeTranslationOrigin(permissions, origin) {
  if (!origin) return false;
  const permission = { origins: [origin] };
  if (!await permissions.contains(permission)) return false;
  if (!await permissions.remove(permission)) {
    throw new Error("无法撤销旧的翻译 API 权限");
  }
  return true;
}

async function restoreTranslationOrigin(permissions, origin) {
  try {
    if (await permissions.request({ origins: [origin] })) return;
  } catch (error) {
    throw new Error("无法恢复旧的翻译 API 权限", { cause: error });
  }
  throw new Error("无法恢复旧的翻译 API 权限");
}

function storedTranslationOrigins(stored, exceptOrigin = "") {
  return [...new Set([
    stored.fullTranscriptTranslationOrigin,
    stored[FULL_TRANSCRIPT_TRANSLATION_PENDING_ORIGIN_KEY],
  ].filter((origin) => origin && origin !== exceptOrigin))];
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

  const revokedOrigins = [];
  try {
    for (const origin of storedTranslationOrigins(stored, config.origin)) {
      if (await revokeTranslationOrigin(permissions, origin)) revokedOrigins.push(origin);
    }
    await storage.set(values);
  } catch (error) {
    let cleanupError = null;
    for (const origin of revokedOrigins) {
      try {
        await restoreTranslationOrigin(permissions, origin);
      } catch (restoreError) {
        cleanupError ??= restoreError;
      }
    }
    if (!permissionExisted) {
      try {
        await rollbackNewOrigin(permissions, config.origin);
      } catch (rollbackError) {
        cleanupError ??= rollbackError;
      }
    }
    throw cleanupError ?? error;
  }
}

export async function clearTranslationSettings({ storage, permissions, stored, keys }) {
  await storage.remove(keys);
  for (const origin of storedTranslationOrigins(stored)) {
    try {
      await revokeTranslationOrigin(permissions, origin);
    } catch (error) {
      await storage.set({
        [FULL_TRANSCRIPT_TRANSLATION_PENDING_ORIGIN_KEY]: origin,
      });
      throw new Error("翻译配置已删除，但无法撤销旧的翻译 API 权限", { cause: error });
    }
  }
}
