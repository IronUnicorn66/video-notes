# 第三方组件说明

- `whisper.cpp`：MIT License。本项目使用其浏览器 WebAssembly 运行方式和 GGML 量化模型格式。
- `@transcribe/shout` 1.0.7：MIT License。提供随扩展打包的 `whisper.cpp` WebAssembly 运行时。
- `@transcribe/transcriber` 3.0.1：MIT License。提供浏览器音频解码和文件转写封装。
- `esbuild` 0.25.6：MIT License。仅在构建阶段使用。
- `fake-indexeddb` 6.0.1：Apache License 2.0。仅在测试阶段使用。
- `ggml-base-q5_1.bin`：由 `ggerganov/whisper.cpp` 发布的 Whisper GGML 量化权重。文件来源、固定版本、大小和 SHA-256 记录在 `src/core/model-config.js`。

发布包保留构建工具生成的许可证注释。完整许可证文本可从各组件随 npm 包提供的许可证文件及对应上游仓库获取。

