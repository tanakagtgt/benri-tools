// 伝言板 API (Cloudflare Pages Functions + D1)
// GET    /api/board         最新50件の投稿を返す
// POST   /api/board         投稿を作成（1IPあたり60秒に1件まで）
// DELETE /api/board?id=N    投稿を削除（削除用パスワード or 管理者キー BOARD_ADMIN_KEY）
// D1バインディング: BOARD_DB / 管理者用シークレット: BOARD_ADMIN_KEY

const encoder = new TextEncoder();

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (!env.BOARD_DB) return json({ ok: false, error: 'board_unavailable' }, 503);
    if (request.method === 'GET') return await listPosts(env);
    if (request.method === 'POST') return await createPost(request, env);
    if (request.method === 'DELETE') return await deletePost(request, env);
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  } catch (e) {
    return json({ ok: false, error: 'server_error' }, 500);
  }
}

async function listPosts(env) {
  const { results } = await env.BOARD_DB.prepare(
    'SELECT id, name, message, created_at FROM posts WHERE deleted = 0 ORDER BY id DESC LIMIT 50'
  ).all();
  return json({ ok: true, posts: results || [] });
}

async function createPost(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  const name = String(body.name || '').trim();
  const message = String(body.message || '').trim();
  const delKey = String(body.delKey || '');
  if (name.length < 1 || name.length > 20) return json({ ok: false, error: 'bad_name' }, 400);
  if (message.length < 1 || message.length > 500) return json({ ok: false, error: 'bad_message' }, 400);
  if (delKey && (delKey.length < 4 || delKey.length > 20)) return json({ ok: false, error: 'bad_delkey' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ipHash = await sha256Hex('board-ip:' + ip);
  const last = await env.BOARD_DB.prepare(
    'SELECT created_at FROM posts WHERE ip_hash = ? ORDER BY id DESC LIMIT 1'
  ).bind(ipHash).first();
  if (last && Date.now() - Date.parse(last.created_at) < 60000) {
    return json({ ok: false, error: 'too_fast' }, 429);
  }

  const delKeyHash = delKey ? await sha256Hex('board-del:' + delKey) : null;
  const createdAt = new Date().toISOString();
  const res = await env.BOARD_DB.prepare(
    'INSERT INTO posts (name, message, created_at, ip_hash, del_key_hash, deleted) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(name, message, createdAt, ipHash, delKeyHash).run();
  return json({ ok: true, id: res.meta.last_row_id }, 201);
}

async function deletePost(request, env) {
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ ok: false, error: 'bad_id' }, 400);

  const adminKey = request.headers.get('X-Admin-Key') || '';
  if (env.BOARD_ADMIN_KEY && adminKey && adminKey === env.BOARD_ADMIN_KEY) {
    await env.BOARD_DB.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  let body = {};
  try { body = await request.json(); } catch { /* no body */ }
  const delKey = String(body.delKey || '');
  if (!delKey) return json({ ok: false, error: 'need_password' }, 403);
  const row = await env.BOARD_DB.prepare(
    'SELECT del_key_hash FROM posts WHERE id = ? AND deleted = 0'
  ).bind(id).first();
  if (!row || !row.del_key_hash) return json({ ok: false, error: 'forbidden' }, 403);
  if ((await sha256Hex('board-del:' + delKey)) !== row.del_key_hash) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  await env.BOARD_DB.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
