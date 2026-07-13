import { createHash } from "node:crypto";

export const FETCH_MAX_ATTEMPTS = 4;
export const FETCH_TIMEOUT_MS = 15000;
export const FETCH_BACKOFF_MS = [150, 300, 600];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function retryableStatus(status) {
  return status === 429 || status >= 500;
}

export async function boundedGet(fetchUrl, options = {}) {
  const auditUrl = options.auditUrl ?? fetchUrl;
  const maxAttempts = options.maxAttempts ?? FETCH_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? FETCH_BACKOFF_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      const response = await fetchImpl(fetchUrl, {
        redirect: "follow",
        signal: controller.signal,
        headers: options.headers,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const canRetry = retryableStatus(response.status);
      const attemptRecord = {
        attempt,
        url: auditUrl,
        http_status: response.status,
        retryable: canRetry,
        elapsed_ms: Date.now() - startedAt,
        bytes: bytes.length,
        content_sha256: sha256(bytes),
        error: null,
      };
      attempts.push(attemptRecord);
      options.onAttempt?.(attemptRecord);

      if (canRetry && attempt < maxAttempts) {
        const waitMs = backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 0;
        options.onBackoff?.({ attempt, url: auditUrl, backoff_ms: waitMs });
        await delay(waitMs);
        continue;
      }

      return {
        http_status: response.status,
        content_sha256: attemptRecord.content_sha256,
        bytes,
        content_type: response.headers.get("content-type") ?? "",
        attempts,
        attempt_count: attempts.length,
        max_attempts: maxAttempts,
        retry_exhausted: canRetry && attempt === maxAttempts,
        final_outcome: response.ok
          ? "response_ok"
          : canRetry
            ? "retry_exhausted"
            : "non_retryable_http_error",
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attemptRecord = {
        attempt,
        url: auditUrl,
        http_status: null,
        retryable: true,
        elapsed_ms: Date.now() - startedAt,
        bytes: 0,
        content_sha256: null,
        error: message,
      };
      attempts.push(attemptRecord);
      options.onAttempt?.(attemptRecord);
      if (attempt < maxAttempts) {
        const waitMs = backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 0;
        options.onBackoff?.({ attempt, url: auditUrl, backoff_ms: waitMs });
        await delay(waitMs);
        continue;
      }
      return {
        http_status: null,
        content_sha256: null,
        bytes: Buffer.alloc(0),
        content_type: "",
        attempts,
        attempt_count: attempts.length,
        max_attempts: maxAttempts,
        retry_exhausted: true,
        final_outcome: "retry_exhausted",
        error: message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("bounded GET ended without a terminal result");
}
