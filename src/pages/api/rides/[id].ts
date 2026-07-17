import type { APIRoute } from 'astro';
import { deleteRide } from '../../../lib/upload-store';
import { json } from '../../../lib/http';

// The single-ride delete endpoint (ticket 4a). Removes the D1 rows and the R2
// object; records and totals are recomputed from summaries on the next index
// read, so nothing is stored to clean up. Dynamic — it mutates the bindings.
export const prerender = false;

export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = params.id;
  if (!id) return json({ error: 'missing ride id' }, 400);

  try {
    const deleted = await deleteRide(locals.runtime.env, id);
    if (!deleted) return json({ error: 'ride not found' }, 404);
    return json({ ok: true, id }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `failed to delete ride: ${message}` }, 500);
  }
};
