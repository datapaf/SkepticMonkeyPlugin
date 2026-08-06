export interface LineUncertaintyItem {
  text: string;
  uncertainty: number;
}

export interface LineEstimateResponse {
  input_text: string;
  generation_text: string;
  lines: LineUncertaintyItem[];
  generation_tokens: number[];
  model_path: string;
  estimator: string;
}

export class SkepticMonkeyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SkepticMonkeyApiError";
  }
}

/**
 * Build the instruct-style prompt expected by SkepticMonkey / DeepSeek-Coder.
 * Only the latest user message is included (no chat history).
 */
export function buildInputText(userMessage: string): string {
  const trimmed = userMessage.trim();
  return `### Instruction:\n${trimmed}\n### Response:\n`;
}

export async function estimateLineUncertainty(
  apiUrl: string,
  inputText: string,
  timeoutMs: number,
): Promise<LineEstimateResponse> {
  const base = apiUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${base}/estimate/line`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_text: inputText }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) {
          detail = payload.detail;
        }
      } catch {
        // ignore JSON parse errors
      }
      throw new SkepticMonkeyApiError(
        `SkepticMonkey API error (${response.status}): ${detail}`,
        response.status,
      );
    }

    return (await response.json()) as LineEstimateResponse;
  } catch (err) {
    if (err instanceof SkepticMonkeyApiError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new SkepticMonkeyApiError(
        `Request timed out after ${timeoutMs}ms. Is the SkepticMonkey server running?`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new SkepticMonkeyApiError(
      `Failed to reach SkepticMonkey at ${base}: ${message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
