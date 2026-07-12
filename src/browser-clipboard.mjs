function resolveEnvironmentValue(environment, key, fallback) {
  return Object.hasOwn(environment, key) ? environment[key] : fallback;
}

async function copyTextToClipboard(text, environment = {}) {
  const clipboard = resolveEnvironmentValue(environment, "clipboard", globalThis.navigator?.clipboard);
  const documentApi = resolveEnvironmentValue(environment, "document", globalThis.document);
  let primaryError;

  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return "clipboard-api";
    } catch (error) {
      primaryError = error;
    }
  }

  if (!documentApi?.body || typeof documentApi.createElement !== "function" || typeof documentApi.execCommand !== "function") {
    throw new Error("Clipboard copy is unavailable in this environment.", { cause: primaryError });
  }

  const temporary = documentApi.createElement("textarea");
  temporary.value = text;
  temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  documentApi.body.append(temporary);

  let copied = false;
  try {
    temporary.select();
    copied = documentApi.execCommand("copy") === true;
  } finally {
    temporary.remove();
  }

  if (!copied) {
    throw new Error("Clipboard copy was rejected by the browser.", { cause: primaryError });
  }
  return "legacy-copy";
}

export { copyTextToClipboard };
