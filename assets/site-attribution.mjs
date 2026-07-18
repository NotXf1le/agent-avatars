const AI_REFERRERS = Object.freeze([
  ["chatgpt.com", "chatgpt"],
  ["perplexity.ai", "perplexity"],
  ["claude.ai", "claude"],
  ["gemini.google.com", "gemini"],
  ["copilot.microsoft.com", "copilot"],
]);

function clean(value, fallback, limit = 80) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized ? normalized.slice(0, limit) : fallback;
}

function referrerSource(referrer) {
  if (!referrer) return null;
  try {
    const hostname = new URL(referrer).hostname.toLowerCase();
    const match = AI_REFERRERS.find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
    return match?.[1] ?? hostname.slice(0, 80);
  } catch {
    return null;
  }
}

function normalizeAiSource(source) {
  const match = AI_REFERRERS.find(([domain, name]) => source === domain || source === name);
  return match?.[1] ?? source;
}

export function getTrafficAttribution(locationLike, referrer = "") {
  const locationUrl = locationLike instanceof URL ? locationLike : new URL(String(locationLike));
  const params = locationUrl.searchParams;
  const referredBy = referrerSource(referrer);
  const source = normalizeAiSource(clean(params.get("utm_source"), referredBy ?? "direct"));
  const medium = clean(params.get("utm_medium"), source === "direct" ? "none" : "referral");
  const campaign = clean(params.get("utm_campaign"), "none");

  return Object.freeze({
    source,
    medium,
    campaign,
    landingPath: locationUrl.pathname,
    aiReferral: AI_REFERRERS.some(([, name]) => name === source),
  });
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail: Object.freeze({ ...detail }) }));
}

export function trackConversion(action, metadata = {}) {
  if (typeof window === "undefined") return;
  emit("agent-avatars:conversion", {
    action: clean(action, "unknown"),
    ...window.agentAvatarsTraffic.attribution,
    ...metadata,
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const attribution = getTrafficAttribution(window.location.href, document.referrer);
  window.agentAvatarsTraffic = Object.freeze({ attribution, trackConversion });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-track]") : null;
    if (target) trackConversion(target.dataset.track, { target: target.tagName.toLowerCase() });
  });

  queueMicrotask(() => emit("agent-avatars:visit", attribution));
}
