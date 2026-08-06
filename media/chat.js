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
   * Mirror HallucinationDetectionViewer colorize_line_ue_output:
   * green/red UE highlighting only inside markdown code fences.
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

      if (isFence) {
        textClass = "fence";
        inCodeBlock = !inCodeBlock;
      } else if (inCodeBlock) {
        showScore = true;
        if (label > ueThreshold) {
          textClass = "high";
          scoreClass = "high";
        } else {
          textClass = "low";
          scoreClass = "low";
        }
      }

      const displayLine = escapeHtml(line).replace(/\n/g, "");

      if (showScore) {
        parts.push(
          `<div class="ue-line">` +
            `<div class="ue-text ${textClass}">${displayLine}</div>` +
            `<span class="ue-score ${scoreClass}">${label.toFixed(3)}</span>` +
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
