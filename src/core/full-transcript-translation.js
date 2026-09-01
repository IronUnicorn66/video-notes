export const FULL_TRANSCRIPT_TRANSLATION_BATCH_SIZE = 40;

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`请填写 ${label}`);
  return text;
}

export function normalizeFullTranscriptTranslationConfig({ baseUrl, apiKey, model }) {
  const parsed = new URL(requiredText(baseUrl, "API Base URL"));
  if (parsed.protocol !== "https:") throw new Error("API Base URL 必须使用 HTTPS");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("API Base URL 格式不正确");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) {
    throw new Error("请填写 API Base URL，而不是完整接口地址");
  }
  const normalizedBaseUrl = `${parsed.origin}${pathname}`;
  return {
    baseUrl: normalizedBaseUrl,
    endpoint: `${normalizedBaseUrl}/chat/completions`,
    origin: `${parsed.origin}/*`,
    apiKey: requiredText(apiKey, "API Key"),
    model: requiredText(model, "模型名"),
  };
}

export function chunkTranscriptCues(cues, batchSize = FULL_TRANSCRIPT_TRANSLATION_BATCH_SIZE) {
  const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0
    ? batchSize
    : FULL_TRANSCRIPT_TRANSLATION_BATCH_SIZE;
  const numbered = cues.map((cue, index) => ({
    ...cue,
    id: Number.isInteger(cue.id) ? cue.id : index,
  }));
  const batches = [];
  for (let index = 0; index < numbered.length; index += safeBatchSize) {
    batches.push(numbered.slice(index, index + safeBatchSize));
  }
  return batches;
}

export function untranslatedTranscriptCues(cues) {
  return cues
    .map((cue, id) => ({ id, text: cue.text }))
    .filter((cue) => !String(cues[cue.id].translation ?? "").trim());
}

export async function requestTranslationHostPermission(permissions, config) {
  const permission = { origins: [config.origin] };
  if (await permissions.contains(permission)) return true;
  return permissions.request(permission);
}

export async function authorizeCurrentTranscriptTranslation({ getState, requestPermission }) {
  const snapshot = getState();
  if (!snapshot?.transcript) return null;
  await requestPermission();
  const current = getState();
  if (
    current?.transcript !== snapshot.transcript
    || current?.generation !== snapshot.generation
    || current?.contextKey !== snapshot.contextKey
  ) return null;
  return snapshot;
}

function jsonContent(value) {
  const trimmed = String(value ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export function parseTranscriptTranslations(content, cues) {
  let parsed;
  try {
    parsed = JSON.parse(jsonContent(content));
  } catch {
    throw new Error("翻译服务返回的内容无法识别");
  }
  if (!Array.isArray(parsed?.translations)) {
    throw new Error("翻译服务返回的内容无法识别");
  }
  const expectedIds = new Set(cues.map((cue) => cue.id));
  const translations = new Map();
  for (const entry of parsed.translations) {
    if (!Number.isInteger(entry?.id) || !expectedIds.has(entry.id)) {
      throw new Error("翻译结果包含未知字幕序号");
    }
    if (translations.has(entry.id)) throw new Error("翻译结果包含重复字幕序号");
    const translation = String(entry.text ?? "").trim();
    if (!translation) throw new Error("翻译结果不完整");
    translations.set(entry.id, translation);
  }
  if (translations.size !== expectedIds.size) throw new Error("翻译结果不完整");
  return cues.map((cue) => ({ id: cue.id, translation: translations.get(cue.id) }));
}

export async function translateTranscriptBatch({ config, cues, fetchImpl = fetch, signal }) {
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        {
          role: "system",
          content: "你是字幕翻译器。把每条字幕翻译成简体中文，保留原有含义与顺序。只返回 JSON：{\\\"translations\\\":[{\\\"id\\\":数字,\\\"text\\\":\\\"译文\\\"}]}。",
        },
        {
          role: "user",
          content: JSON.stringify({
            cues: cues.map(({ id, text }) => ({ id, text })),
          }),
        },
      ],
    }),
    signal,
  });
  if (!response.ok) throw new Error(`翻译服务请求失败（HTTP ${response.status}）`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("翻译服务返回的内容无法识别");
  }
  return parseTranscriptTranslations(payload?.choices?.[0]?.message?.content, cues);
}
