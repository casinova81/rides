// Shared helper for the Worker API routes (issue 02). The upload and delete
// endpoints both reply in JSON with a status code; keeping the response shape
// in one place stops the two from drifting.

/** A JSON `Response` with the given body and status (default 200). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
