// Workerエントリ。/ws/:code をルームのDurable Objectへ振り分ける。
export { RoomDO } from './room-do.js';

const CODE_RE = /^[A-Z0-9]{4,8}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    const m = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('ルームコードが不正です', { status: 400 });
      const id = env.ROOM.idFromName(code);
      return env.ROOM.get(id).fetch(req);
    }
    return new Response('not found', { status: 404 });
  },
};
