export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_EMBED_MODEL = "nomic-embed-text";
export const BATCH_SIZE = 32;
export const DEFAULT_TIMEOUT_MS = 30000;

export class EmbedderUnreachable extends Error {
  constructor(url, cause) {
    super(`embedder unreachable at ${url}: ${cause}`);
    this.name = "EmbedderUnreachable";
    this.exitCode = 3;
    this.url = url;
  }
}

export function embedderConfig(env = process.env) {
  return {
    url: (env.OLLAMA_URL || DEFAULT_OLLAMA_URL).replace(/\/$/, ""),
    model: env.X_SEARCH_EMBED_MODEL || DEFAULT_EMBED_MODEL,
    batchSize: Number(env.X_SEARCH_BATCH_SIZE || BATCH_SIZE),
    timeoutMs: Number(env.X_SEARCH_EMBED_TIMEOUT || DEFAULT_TIMEOUT_MS),
  };
}

export async function embedBatch(texts, { url, model, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(`${url}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new EmbedderUnreachable(url, cause.message);
  }
  if (response.status >= 500 || response.status === 404) {
    throw new EmbedderUnreachable(url, `HTTP ${response.status}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new EmbedderUnreachable(url, detail.slice(0, 200));
  }
  const payload = await response.json();
  if (!Array.isArray(payload.embeddings)) throw new EmbedderUnreachable(url, "no embeddings in the response");
  return payload.embeddings.map((row) => Float32Array.from(row));
}

export async function assertEmbedder(env = process.env) {
  const { url, model } = embedderConfig(env);
  const [probe] = await embedBatch(["probe"], { url, model });
  return { url, model, dims: probe.length };
}

export function toBlob(vector) {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function fromBlob(blob) {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}

export function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}
