const MODEL_REVISION = "98aa99a0a9db05ae2342309f5096248665f7cba3";
const MODEL_CACHE_NAME = "video-notes-whisper-v1";

export const DEFAULT_WHISPER_MODEL_ID = "base-q5_1";

export const WHISPER_MODELS = Object.freeze([
  {
    id: "base-q5_1",
    label: "Base · 57 MiB",
    filename: "ggml-base-q5_1.bin",
    size: 59_707_625,
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    recommended: true,
  },
  {
    id: "small-q5_1",
    label: "Small · 181 MiB",
    filename: "ggml-small-q5_1.bin",
    size: 190_085_487,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
  },
  {
    id: "medium-q5_0",
    label: "Medium · 514 MiB",
    filename: "ggml-medium-q5_0.bin",
    size: 539_212_467,
    sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
    experimental: true,
  },
].map((model) => Object.freeze({
  ...model,
  url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/${model.filename}`,
  cacheName: MODEL_CACHE_NAME,
})));

export function getWhisperModel(modelId) {
  const model = WHISPER_MODELS.find(({ id }) => id === modelId);
  if (!model) throw new Error(`未知 Whisper 模型：${modelId}`);
  return model;
}

export const WHISPER_MODEL = getWhisperModel(DEFAULT_WHISPER_MODEL_ID);

export const WHISPER_ORIGINS = Object.freeze([
  "https://huggingface.co/*",
  "https://cdn-lfs.hf.co/*",
  "https://*.xethub.hf.co/*",
]);
