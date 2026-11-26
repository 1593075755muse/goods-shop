// inbox.js — 验证码收件箱读取器（可插拔模块）
//
// 契约（app.js 只依赖这个，不依赖具体供应商）：
// getCodes(email) -> Promise<[{ otp: string, time: string }]>，按时间倒序（最新在前）
// otp = 邮箱里收到的验证码（纯数字/字母串）；time = 收到时间，ISO 8601 字符串
//
// 当前实现：调自家 OTP Worker（Cloudflare Email Routing catch-all → Worker → KV）。
// GET <OTP_WORKER_URL>/otp/<local> 返回 [{"otp","time"}]，local 是邮箱 @ 前面的部分。
// OTP_WORKER_URL 默认 https://muse-shop-otp.ondere.workers.dev，可用环境变量覆盖。
// Worker 不可达/返回异常时返回 []（app.js 会照常返回空列表，不抛 502，除非 fetch 本身抛错）。
const OTP_WORKER_URL = (process.env.OTP_WORKER_URL || 'https://muse-shop-otp.ondere.workers.dev').replace(/\/+$/, '');

function localPart(email) {
  const em = String(email || '').trim().toLowerCase();
  const at = em.indexOf('@');
  return at >= 0 ? em.slice(0, at) : em;
}

// 异步实现：调 Worker 的 /otp 接口
async function getCodes(email) {
  const local = localPart(email);
  if (!local) return [];
  const url = `${OTP_WORKER_URL}/otp/${encodeURIComponent(local)}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    console.error('inbox worker fetch failed', url, e.message);
    return [];
  }
  if (!res.ok) {
    console.error('inbox worker bad status', res.status, url);
    return [];
  }
  let rows;
  try {
    rows = await res.json();
  } catch (e) {
    console.error('inbox worker bad json', e.message);
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .map((x) => ({ otp: String((x && x.otp) || ''), time: String((x && x.time) || '') }))
    .filter((x) => x.otp)
    .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
}

module.exports = { getCodes };
