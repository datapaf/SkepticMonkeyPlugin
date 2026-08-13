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

  /**
   * Highlight only code lines (inside markdown fences) whose uncertainty
   * exceeds the threshold. Fill intensity scales with how far above threshold.
   */
  function colorizeLineUeOutput(lines, ueThreshold) {
    const parts = [];
    let inCodeBlock = false;

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
        inCodeBlock = !inCodeBlock;
      } else if (inCodeBlock && label > ueThreshold) {
        showScore = true;
        textClass = "high";
        scoreClass = "high";
        intensity = uncertaintyIntensity(label, ueThreshold);
      } else if (inCodeBlock) {
        textClass = "code";
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
