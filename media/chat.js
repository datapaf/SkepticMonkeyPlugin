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

  if (typeof marked !== "undefined") {
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Intensity from absolute uncertainty: 0 → transparent, 1 → full red.
   * Callers still gate on label > threshold before highlighting.
   */
  function uncertaintyIntensity(label, _ueThreshold) {
    return Math.min(1, Math.max(0, Number(label) || 0));
  }

  /** Background fill: transparent at 0 → strong red at 1. */
  function uncertaintyFillStyle(intensity) {
    const alpha = intensity * 0.62;
    return `background-color: rgba(198, 40, 40, ${alpha.toFixed(3)});`;
  }

  function scoreColorStyle(_intensity) {
    return "color: #e53935;";
  }

  function fenceLanguage(fenceLine) {
    const match = fenceLine.trim().match(/^```(\w[\w+-]*)?/);
    return (match && match[1] ? match[1] : "").toLowerCase();
  }

  function normalizeHljsLang(lang) {
    const aliases = {
      py: "python",
      python3: "python",
      js: "javascript",
      ts: "typescript",
      tsx: "typescript",
      jsx: "javascript",
      rb: "ruby",
      sh: "bash",
      shell: "bash",
      zsh: "bash",
      yml: "yaml",
      csharp: "csharp",
      cs: "csharp",
      "c++": "cpp",
      rs: "rust",
      kt: "kotlin",
      plaintext: "plaintext",
      text: "plaintext",
    };
    return aliases[lang] || lang || "plaintext";
  }

  function usesHashComments(lang) {
    return (
      !lang ||
      /^(py|python|python3|ruby|rb|perl|pl|r|shell|bash|sh|zsh|powershell|ps1|yaml|yml|toml|dockerfile|makefile|cmake|elixir|ex|julia|jl)$/.test(
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
   * Trailing comments on code lines do not count.
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

    if (usesHashComments(lang) && stripped.startsWith("#")) {
      return true;
    }
    if (usesDashComments(lang) && stripped.startsWith("--")) {
      return true;
    }
    if (usesSlashComments(lang) && stripped.startsWith("//")) {
      return true;
    }

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

  function stripTrailingNewline(text) {
    return text.replace(/[\r\n]+$/, "");
  }

  /** Split API line items that contain embedded newlines into one row each. */
  function expandCodeItems(codeItems) {
    const out = [];
    for (const item of codeItems || []) {
      const text = stripTrailingNewline(item.text ?? "");
      const parts = text.split(/\r?\n/);
      for (const part of parts) {
        out.push({
          text: part,
          uncertainty: Number(item.uncertainty),
        });
      }
    }
    return out;
  }

  function highlightCode(code, lang) {
    if (typeof hljs === "undefined") {
      return escapeHtml(code);
    }
    const normalized = normalizeHljsLang(lang);
    try {
      if (normalized && hljs.getLanguage(normalized)) {
        return hljs.highlight(code, {
          language: normalized,
          ignoreIllegals: true,
        }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch (_err) {
      return escapeHtml(code);
    }
  }

  function parseMarkdown(text) {
    if (!text) {
      return "";
    }
    if (typeof marked === "undefined") {
      return `<div class="content">${escapeHtml(text)}</div>`;
    }
    return `<div class="markdown-body">${marked.parse(text)}</div>`;
  }

  function isProgrammingLanguage(lang) {
    if (!lang) {
      return false;
    }
    const key = String(lang).toLowerCase();
    // Unlabeled / plain-output fences — no uncertainty highlight
    if (
      /^(plaintext|text|txt|output|console|shell-session|repl|raw|none)$/.test(
        key,
      )
    ) {
      return false;
    }
    return true;
  }

  function displayLanguageName(lang) {
    if (!isProgrammingLanguage(lang)) {
      return "";
    }
    const names = {
      py: "Python",
      python: "Python",
      python3: "Python",
      js: "JavaScript",
      javascript: "JavaScript",
      ts: "TypeScript",
      typescript: "TypeScript",
      tsx: "TSX",
      jsx: "JSX",
      rb: "Ruby",
      ruby: "Ruby",
      rs: "Rust",
      rust: "Rust",
      go: "Go",
      java: "Java",
      c: "C",
      cpp: "C++",
      "c++": "C++",
      cs: "C#",
      csharp: "C#",
      sh: "Shell",
      bash: "Shell",
      shell: "Shell",
      zsh: "Shell",
      sql: "SQL",
      html: "HTML",
      css: "CSS",
      json: "JSON",
      yaml: "YAML",
      yml: "YAML",
      md: "Markdown",
      markdown: "Markdown",
    };
    const key = String(lang).toLowerCase();
    if (names[key]) {
      return names[key];
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function renderCodeBlock(codeItems, lang, ueThreshold) {
    const blockState = { kind: null, opener: null };
    const rows = [];
    const expanded = expandCodeItems(codeItems);
    const applyUncertainty = isProgrammingLanguage(lang);

    for (let i = 0; i < expanded.length; i++) {
      const item = expanded[i];
      const label = Number(item.uncertainty);
      const rawLine = item.text ?? "";
      const stripped = rawLine.replace(/^\s+/, "");
      const commentOnly = isCommentOnlyLine(stripped, lang, blockState);
      // Per-line highlight keeps scores aligned with the exact source line.
      const hlLine = highlightCode(rawLine, lang);

      if (
        applyUncertainty &&
        !commentOnly &&
        label > ueThreshold
      ) {
        const intensity = uncertaintyIntensity(label, ueThreshold);
        const leadingMatch = rawLine.match(/^[ \t]*/);
        const leading = leadingMatch ? leadingMatch[0] : "";
        const leadingHtml = leading
          ? `<span class="ue-indent">${escapeHtml(leading)}</span>`
          : "";

        let contentHtml = hlLine;
        if (leading) {
          const escapedIndent = escapeHtml(leading);
          if (contentHtml.startsWith(escapedIndent)) {
            contentHtml = contentHtml.slice(escapedIndent.length);
          } else {
            contentHtml = contentHtml.replace(/^[ \t]+/, "");
          }
        }

        rows.push(
          `<span class="ue-line">` +
            leadingHtml +
            `<span class="ue-text high" style="${uncertaintyFillStyle(intensity)}">${contentHtml || "&nbsp;"}</span>` +
            `<span class="ue-score" style="${scoreColorStyle(intensity)}">${label.toFixed(3)}</span>` +
            `</span>`,
        );
      } else {
        rows.push(
          `<span class="code-line">${hlLine || "&nbsp;"}</span>`,
        );
      }
    }

    const normalized = normalizeHljsLang(lang);
    const langClass = lang ? ` language-${escapeHtml(normalized)}` : "";
    const langLabel = displayLanguageName(lang);
    const header = langLabel
      ? `<div class="code-lang">${escapeHtml(langLabel)}</div>`
      : "";
    return (
      `<div class="code-block-wrap">` +
      header +
      `<pre class="code-block"><code class="hljs${langClass}">` +
      rows.join("") +
      `</code></pre></div>`
    );
  }

  /**
   * Render API lines as markdown prose + syntax-highlighted code fences,
   * with uncertainty fill on non-comment code lines above threshold.
   */
  function renderLinesAsMarkdown(lines, ueThreshold) {
    const parts = [];
    let proseBuf = "";
    let inCode = false;
    let lang = "";
    let codeItems = [];

    function flushProse() {
      if (!proseBuf) {
        return;
      }
      parts.push(parseMarkdown(proseBuf));
      proseBuf = "";
    }

    function flushCode() {
      parts.push(renderCodeBlock(codeItems, lang, ueThreshold));
      codeItems = [];
      lang = "";
    }

    for (const item of lines || []) {
      const line = item.text ?? "";
      const stripped = line.replace(/^\s+/, "");
      const isFence = stripped.startsWith("```");

      if (isFence) {
        if (!inCode) {
          flushProse();
          inCode = true;
          lang = fenceLanguage(stripped);
          codeItems = [];
          // Support ```python def foo(): on one line
          const restMatch = stripped.match(/^```[\w+-]*[ \t]*(.*)$/);
          const rest = restMatch && restMatch[1] ? restMatch[1] : "";
          if (rest) {
            codeItems.push({
              text: rest,
              uncertainty: item.uncertainty,
            });
          }
        } else {
          flushCode();
          inCode = false;
        }
        continue;
      }

      if (inCode) {
        codeItems.push(item);
      } else {
        proseBuf += line;
      }
    }

    if (inCode) {
      // Unclosed fence: treat remaining as code.
      flushCode();
    }
    flushProse();

    return `<div class="assistant-md">${parts.join("")}</div>`;
  }

  function renderPlain(content) {
    return `<div class="content">${escapeHtml(content)}</div>`;
  }

  function renderAssistantBody(msg) {
    if (Array.isArray(msg.lines) && msg.lines.length) {
      return renderLinesAsMarkdown(msg.lines, threshold);
    }
    return parseMarkdown(msg.content || "");
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = "";

    if (!messages || messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Skeptic Monkey\n[Conceptual Preview]";
      messagesEl.appendChild(empty);
      return;
    }

    for (const msg of messages) {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${msg.role}`;

      const body = document.createElement("div");
      if (msg.role === "assistant") {
        body.innerHTML = renderAssistantBody(msg);
      } else {
        body.innerHTML = renderPlain(msg.content || "");
      }
      bubble.appendChild(body);

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
    apiHint.textContent = message.modelName
      ? String(message.modelName)
      : "Model unknown";
    setBusy(Boolean(message.busy));
    renderMessages(message.messages || []);
  });

  vscode.postMessage({ type: "ready" });
})();
