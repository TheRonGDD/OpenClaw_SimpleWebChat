/**
 * Image Generation Client
 *
 * Thin HTTP client that forwards image generation requests to the local
 * imagegen-service running at localhost:18791 inside a diffusers container.
 */

const IMAGEGEN_URL = "http://127.0.0.1:18791";
const GENERATE_TIMEOUT = 120_000; // 120s — accounts for cold start model loading

export interface ImageGenOptions {
  prompt: string;
  negativePrompt?: string;
  steps?: number;
  width?: number;
  height?: number;
}

export interface ImageGenResult {
  filename: string;
  url: string;
  prompt: string;
  seed: number;
  elapsed: number;
}

export interface ImageGenError {
  error: string;
}

/**
 * Request image generation from the local SD service.
 * Returns the media URL path on success, or an error message.
 */
export async function generateImage(
  opts: ImageGenOptions,
): Promise<ImageGenResult | ImageGenError> {
  const body = {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt,
    steps: opts.steps ?? 20,
    width: opts.width ?? 512,
    height: opts.height ?? 512,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT);

    const res = await fetch(`${IMAGEGEN_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      return { error: `Image generation failed (${res.status}): ${text}` };
    }

    const data = await res.json();
    return {
      filename: data.filename,
      url: data.path,
      prompt: data.prompt,
      seed: data.seed,
      elapsed: data.elapsed,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { error: "Image generation timed out (120s). The model may still be loading." };
    }
    return { error: `Image generation service unavailable: ${err.message}` };
  }
}

/**
 * Check if the imagegen service is reachable and what state it's in.
 */
export async function imageGenHealth(): Promise<{
  status: string;
  model: string;
  available: boolean;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(`${IMAGEGEN_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return { status: "error", model: "unknown", available: false };

    const data = await res.json();
    return { status: data.status, model: data.model, available: true };
  } catch {
    return { status: "offline", model: "unknown", available: false };
  }
}
