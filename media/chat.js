(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const clearBtn = document.getElementById("clearBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const apiHint = document.getElementById("apiHint");

  let threshold = 0.5;
  let busy = false;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Map uncertainty above the threshold to [0, 1] intensity
   * (near threshold → low, near 1 → high).
   */
  function uncertaintyIntensity(label, ueThreshold) {
    const span = Math.max(1e-6, 1 - ueThreshold);
    return Math.min(1, Math.max(0, (label - ueThreshold) / span));
  }

  /** Soft → strong red fill/text from intensity. */
  function uncertaintyHighlightStyle(intensity) {
    const fillAlpha = 0.1 + intensity * 0.42;
    const textAlpha = 0.55 + intensity * 0.45;
    return (
      `background-color: rgba(198, 40, 40, ${fillAlpha.toFixed(3)}); ` +
      `color: rgba(198, 40, 40, ${textAlpha.toFixed(3)});`
    );
  }

  function fenceLanguage(fenceLine) {
    const match = fenceLine.trim().match(/^```(\w[\w+-]*)?/);
    return (match && match[1] ? match[1] : "").toLowerCase();
  }

  function usesHashComments(lang) {
    return (
      !lang ||
      /^(py|python|ruby|rb|perl|pl|r|shell|bash|sh|zsh|powershell|ps1|yaml|yml|toml|dockerfile|makefile|cmake|elixir|ex|julia|jl|python3)$/.test(
        lang,
      )
    );
  }

  function usesSlashComments(lang) {
    return (
      !lang ||
      /^(js|javascript|ts|typescript|jsx|tsx|java|c|cpp|c\+\+|csharp|cs|go|rust|rs|kotlin|kt|swift|scala|php|dart|groovy|objectivec|objc|jsonc|vue|svelte)$/.test(
        lang,
      )
    );
  }

  function usesDashComments(lang) {
    return !lang || /^(sql|haskell|hs|lua|elm)$/.test(lang);
  }

  /**
   * True only when the whole line is a comment (no code).
   * Lines like `x = 1  # note` or `foo(); // note` are NOT comment-only.
   * Updates blockState for multi-line block comments, HTML comments, and docstrings.
   */
  function isCommentOnlyLine(stripped, lang, blockState) {
    if (!stripped) {
      return false;
    }

    if (blockState.kind === "slash") {
      const end = stripped.indexOf("*/");
      if (end === -1) {
        return true;
      }
      blockState.kind = null;
      // Comment-only iff nothing but whitespace after */
      return stripped.slice(end + 2).trim() === "";
    }
    if (blockState.kind === "html") {
      const end = stripped.indexOf("-->");
      if (end === -1) {
        return true;
      }
      blockState.kind = null;
      return stripped.slice(end + 3).trim() === "";
    }
    if (blockState.kind === "hash-doc") {
      const opener = blockState.opener || '"""';
      const end = stripped.indexOf(opener);
      if (end === -1) {
        return true;
      }
      blockState.kind = null;
      blockState.opener = null;
      return stripped.slice(end + opener.length).trim() === "";
    }

    // Full-line line comments (must start at first non-space char).
    if (usesHashComments(lang) && stripped.startsWith("#")) {
      return true;
    }
    if (usesDashComments(lang) && stripped.startsWith("--")) {
      return true;
    }
    if (usesSlashComments(lang) && stripped.startsWith("//")) {
      return true;
    }

    // Full-line /* ... */ or start of a multi-line block comment.
    if (usesSlashComments(lang) && stripped.startsWith("/*")) {
      const end = stripped.indexOf("*/");
      if (end === -1) {
        blockState.kind = "slash";
        return true;
      }
      return stripped.slice(end + 2).trim() === "";
    }

    if (
      (!lang || /^(html|xml|svg|markdown|md)$/.test(lang)) &&
      stripped.startsWith("<!--")
    ) {
      const end = stripped.indexOf("-->");
      if (end === -1) {
        blockState.kind = "html";
        return true;
      }
      return stripped.slice(end + 3).trim() === "";
    }

    // Full-line Python/Ruby docstrings.
    if (usesHashComments(lang) && /^("""|''')/.test(stripped)) {
      const opener = stripped.startsWith('"""') ? '"""' : "'''";
      const rest = stripped.slice(3);
      const end = rest.indexOf(opener);
      if (end === -1) {
        blockState.kind = "hash-doc";
        blockState.opener = opener;
        return true;
      }
      return rest.slice(end + 3).trim() === "";
    }

    return false;
  }

  /**
   * Highlight uncertain code lines inside fences. Skips comment-only lines;
   * code lines that also have trailing comments can still be highlighted.
   */
  function colorizeLineUeOutput(lines, ueThreshold) {
    const parts = [];
    let inCodeBlock = false;
    let lang = "";
    const blockState = { kind: null, opener: null };

    for (const item of lines || []) {
      const line = item.text ?? "";
      const label = Number(item.uncertainty);
      const stripped = line.replace(/^\s+/, "");
      const isFence = stripped.startsWith("```");

      let showScore = false;
      let textClass = "prose";
      let scoreClass = "";
      let intensity = 0;

      if (isFence) {
        textClass = "fence";
        if (!inCodeBlock) {
          lang = fenceLanguage(stripped);
          blockState.kind = null;
          blockState.opener = null;
          inCodeBlock = true;
        } else {
          inCodeBlock = false;
          lang = "";
          blockState.kind = null;
          blockState.opener = null;
        }
      } else if (inCodeBlock) {
        const commentOnly = isCommentOnlyLine(stripped, lang, blockState);
        if (!commentOnly && label > ueThreshold) {
          showScore = true;
          textClass = "high";
          scoreClass = "high";
          intensity = uncertaintyIntensity(label, ueThreshold);
        } else {
          textClass = "code";
        }
      }

      const displayLine = escapeHtml(line).replace(/\n/g, "");

      if (showScore) {
        const leadingMatch = line.match(/^[ \t]*/);
        const leading = leadingMatch ? leadingMatch[0] : "";
        const trimmed = line.slice(leading.length).replace(/\n/g, "");
        const indentHtml = leading
          ? `<span class="ue-indent">${escapeHtml(leading)}</span>`
          : "";
        const style = uncertaintyHighlightStyle(intensity);
        parts.push(
          `<div class="ue-line">` +
            indentHtml +
            `<div class="ue-text ${textClass}" style="${style}">${escapeHtml(trimmed)}</div>` +
            `<span class="ue-score ${scoreClass}" style="color: rgba(198, 40, 40, ${(0.55 + intensity * 0.45).toFixed(3)});">${label.toFixed(3)}</span>` +
            `</div>`,
        );
      } else {
        parts.push(
          `<div class="ue-text ${textClass}">${displayLine}</div>`,
        );
      }
    }

    return `<div class="ue-block">${parts.join("")}</div>`;
  }

  function renderPlain(content) {
    return `<div class="content">${escapeHtml(content)}</div>`;
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = "";

    if (!messages || messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent =
        "Start a conversation. Only your latest message is sent to SkepticMonkey; replies show uncertainty on code lines.";
      messagesEl.appendChild(empty);
      return;
    }

    for (const msg of messages) {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${msg.role}`;

      const role = document.createElement("div");
      role.className = "role";
      role.textContent =
        msg.role === "user"
          ? "You"
          : msg.role === "assistant"
            ? "SkepticMonkey"
            : "Error";
      bubble.appendChild(role);

      const body = document.createElement("div");
      if (msg.role === "assistant" && Array.isArray(msg.lines) && msg.lines.length) {
        body.innerHTML = colorizeLineUeOutput(msg.lines, threshold);
      } else {
        body.innerHTML = renderPlain(msg.content || "");
      }
      bubble.appendChild(body);

      if (msg.meta && (msg.meta.model_path || msg.meta.estimator)) {
        const meta = document.createElement("div");
        meta.className = "meta";
        const bits = [];
        if (msg.meta.model_path) {
          bits.push(msg.meta.model_path);
        }
        if (msg.meta.estimator) {
          bits.push(msg.meta.estimator);
        }
        meta.textContent = bits.join(" · ");
        bubble.appendChild(meta);
      }

      messagesEl.appendChild(bubble);
    }

    if (busy) {
      const note = document.createElement("div");
      note.className = "busy-note";
      note.textContent = "Generating with uncertainty estimates…";
      messagesEl.appendChild(note);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    sendBtn.disabled = busy;
    inputEl.disabled = busy;
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text || busy) {
      return;
    }
    vscode.postMessage({ type: "send", text });
    inputEl.value = "";
  }

  sendBtn.addEventListener("click", send);
  clearBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "clear" });
  });
  settingsBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "openSettings" });
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.type !== "state") {
      return;
    }
    threshold =
      typeof message.threshold === "number" ? message.threshold : 0.5;
    apiHint.textContent = `API: ${message.apiUrl || "http://127.0.0.1:8000"} · threshold ${threshold}`;
    setBusy(Boolean(message.busy));
    renderMessages(message.messages || []);
  });

  vscode.postMessage({ type: "ready" });
})();
