export async function captureYoutubePlayerTranscript(timeoutMs = 8000, runtime) {
  const pageWindow = runtime?.window ?? window;
  const pageDocument = runtime?.document ?? document;
  const wait = runtime?.wait ?? ((duration) => new Promise((resolve) => {
    pageWindow.setTimeout(resolve, duration);
  }));
  const expectedVideoId = String(
    runtime?.videoId
      ?? new URL(pageWindow.location.href).searchParams.get("v")
      ?? "",
  );
  const captureKey = Symbol.for("video-notes.youtubeTranscriptCapture");
  const previousCapture = pageWindow[captureKey] ?? Promise.resolve();
  const runCapture = previousCapture.catch(() => {}).then(async () => {
    const currentVideoId = new URL(pageWindow.location.href).searchParams.get("v") ?? "";
    if (!expectedVideoId || currentVideoId !== expectedVideoId) {
      return { ok: false, code: "YOUTUBE_PLAYER_CONTEXT_CHANGED" };
    }
    const isCurrentCaptionUrl = (value) => {
      try {
        const url = new URL(String(value), pageWindow.location.href);
        return url.protocol === "https:"
          && ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
          && url.pathname === "/api/timedtext"
          && url.searchParams.get("v") === expectedVideoId;
      } catch {
        return false;
      }
    };
    const readBody = async (response) => {
      if (!response?.ok) return "";
      try {
        return await (response.clone?.() ?? response).text();
      } catch {
        return "";
      }
    };

    const previousRequests = pageWindow.performance?.getEntriesByType?.("resource") ?? [];
    const reusableUrls = previousRequests
      .map((entry) => entry.name)
      .filter(isCurrentCaptionUrl)
      .reverse();
    for (const url of reusableUrls) {
      try {
        const body = await readBody(await pageWindow.fetch(url, { credentials: "include" }));
        if (body.trim()) {
          return {
            ok: true,
            transport: "performance-entry",
            url,
            body,
          };
        }
      } catch {
        // Continue to the active player capture below.
      }
    }

    const subtitleButton = pageDocument.querySelector(".ytp-subtitles-button");
    if (!subtitleButton || typeof subtitleButton.click !== "function") {
      return { ok: false, code: "YOUTUBE_PLAYER_CAPTION_CONTROL_MISSING" };
    }

    const originalFetch = pageWindow.fetch;
    const XMLHttpRequestClass = pageWindow.XMLHttpRequest;
    const originalOpen = XMLHttpRequestClass?.prototype.open;
    const originalSend = XMLHttpRequestClass?.prototype.send;
    const xhrCaptionUrls = new WeakMap();
    let wrappedFetch = null;
    let wrappedOpen = null;
    let wrappedSend = null;
    let settleCapture;
    let timeoutId;
    const capture = new Promise((resolve) => {
      settleCapture = resolve;
    });
    const acceptResponse = async (url, response, transport) => {
      if (!isCurrentCaptionUrl(url)) return;
      const body = await readBody(response);
      if (body.trim()) {
        settleCapture({ ok: true, transport, url: String(url), body });
      }
    };
    const initiallyPressed = subtitleButton.getAttribute("aria-pressed") === "true";

    try {
      if (typeof originalFetch === "function") {
        wrappedFetch = async function(...args) {
          const response = await Reflect.apply(originalFetch, this, args);
          const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
          void acceptResponse(url, response, "fetch");
          return response;
        };
        pageWindow.fetch = wrappedFetch;
      }

      if (originalOpen && originalSend) {
        wrappedOpen = function(method, url, ...rest) {
          xhrCaptionUrls.set(this, isCurrentCaptionUrl(url) ? String(url) : "");
          return Reflect.apply(originalOpen, this, [method, url, ...rest]);
        };
        wrappedSend = function(...args) {
          const captionUrl = xhrCaptionUrls.get(this);
          if (captionUrl) {
            this.addEventListener("load", () => {
              let body = "";
              try {
                body = typeof this.responseText === "string" ? this.responseText : "";
              } catch {
                body = "";
              }
              if (this.status >= 200 && this.status < 300 && body.trim()) {
                settleCapture({
                  ok: true,
                  transport: "xhr",
                  url: captionUrl,
                  body,
                });
              }
            }, { once: true });
          }
          return Reflect.apply(originalSend, this, args);
        };
        XMLHttpRequestClass.prototype.open = wrappedOpen;
        XMLHttpRequestClass.prototype.send = wrappedSend;
      }

      if (initiallyPressed) {
        subtitleButton.click();
        await wait(150);
      }
      subtitleButton.click();
      const timeout = new Promise((resolve) => {
        timeoutId = pageWindow.setTimeout(() => resolve({
          ok: false,
          code: "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED",
        }), timeoutMs);
      });
      return await Promise.race([capture, timeout]);
    } finally {
      if (timeoutId !== undefined) pageWindow.clearTimeout(timeoutId);
      if (pageWindow.fetch === wrappedFetch) pageWindow.fetch = originalFetch;
      if (XMLHttpRequestClass?.prototype.open === wrappedOpen) {
        XMLHttpRequestClass.prototype.open = originalOpen;
      }
      if (XMLHttpRequestClass?.prototype.send === wrappedSend) {
        XMLHttpRequestClass.prototype.send = originalSend;
      }
      const currentlyPressed = subtitleButton.getAttribute("aria-pressed") === "true";
      if (currentlyPressed !== initiallyPressed) subtitleButton.click();
    }
  });
  pageWindow[captureKey] = runCapture;
  try {
    return await runCapture;
  } finally {
    if (pageWindow[captureKey] === runCapture) delete pageWindow[captureKey];
  }
}
