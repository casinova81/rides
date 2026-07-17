import type { APIRoute } from 'astro';
import { storeRide, validateUploadBody, UploadValidationError } from '../../lib/upload-store';
import { json } from '../../lib/http';

// The single-ride upload endpoint (issue 02: an Astro API route compiled into the
// same Worker). The browser parses the GPX and derives the payload; this route
// only validates the shape and stores it (R2 + D1), then reports the outcome and
// which records the ride broke. Dynamic — it reads/writes the bindings per request.
export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'request body is not valid JSON' }, 400);
  }

  let body;
  try {
    body = validateUploadBody(raw);
  } catch (err) {
    if (err instanceof UploadValidationError) return json({ error: err.message }, 400);
    throw err;
  }

  try {
    const result = await storeRide(locals.runtime.env, body);
    return json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `failed to store ride: ${message}` }, 500);
  }
};
