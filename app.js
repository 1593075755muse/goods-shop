// 小铺子 · 自动发卡平台（仿 16688 发卡网版式）
// Node 22 + Express，无数据库：
//   商品目录在 items.json（进 git）
//   卡密库存 / 订单 / 设置存在 data/*.json（不进 git，见 .gitignore）
// 部署到 Abasthan 免费档：启动命令 npm start（node app.js）。
// 注意：个人收款码无法自动核验到账，所以流程是：
//   买家扫码付款 -> 点“我已付款” -> 店主在管理后台点“确认收款” -> 卡密自动发给买家
//   （可在管理后台打开“自动发货”，买家点“我已付款”后直接发卡，适合小额/信任场景）
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- 数据层 ----------------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJson(name, fallback) {
  const p = path.join(DATA_DIR, name);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error('read', name, e.message); }
  return fallback;
}
function saveJson(name, obj) {
  const p = path.join(DATA_DIR, name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

const DEFAULT_SETTINGS = {
  shopName: '小铺子',
  announcement:
    '欢迎来到小铺子！下单须知：1、下单前请确认商品类型、价格；2、激活码商品付款后自动发卡，卡密一经发出不支持退款；3、交易中请勿向任何人提供密码、短信验证码；4、订单异常请联系客服并提供订单号。',
  contactQQ: '',
  contactWechat: '',
  qrWechat: '',   // base64 data URI，管理后台上传
  qrAlipay: '',   // base64 data URI，管理后台上传
  autoDeliver: false, // true = 买家点“我已付款”后直接发卡；false = 需店主后台确认收款
  adminPass: 'xiaopu123', // 首次登录密码，请在管理后台尽快修改
};
let settings = Object.assign({}, DEFAULT_SETTINGS, loadJson('settings.json', {}));
let cards = loadJson('cards.json', []);     // {id, productId, code, demo, used, orderNo, usedAt}
let orders = loadJson('orders.json', []);   // {orderNo, productId, name, qty, unitPrice, total, email, payMethod, txid, status, codes, createdAt, paidAt, deliveredAt}
let orderSeq = 1;

function saveSettings() { saveJson('settings.json', settings); }
function saveCards() { saveJson('cards.json', cards); }
function saveOrders() { saveJson('orders.json', orders); }

const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'items.json'), 'utf8'));

const CATEGORIES = {
  skin: '武器皮肤',
  crate: '补给箱',
  outfit: '服装',
  emote: '表情',
  key: '激活码',
};

// ---------------- 卡密库存 ----------------
const DEMO_KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeDemoKey() {
  const group = () =>
    Array.from({ length: 5 }, () => DEMO_KEY_CHARS[Math.floor(Math.random() * DEMO_KEY_CHARS.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}
// 首次启动：给激活码商品预置演示卡密（明确标注 demo，仅供测试流程）
// 店主在管理后台加了真卡密后，可一键清空演示卡。
function seedDemoCards() {
  let changed = false;
  for (const it of items) {
    if (it.category !== 'key') continue;
    const existing = cards.filter((c) => c.productId === it.id);
    if (existing.length > 0) continue;
    for (let i = 0; i < it.stock; i++) {
      cards.push({
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        productId: it.id,
        code: makeDemoKey(),
        demo: true,
        used: false,
        orderNo: null,
        usedAt: null,
      });
    }
    changed = true;
  }
  if (changed) saveCards();
}
seedDemoCards();

function unusedCards(productId) {
  return cards.filter((c) => c.productId === productId && !c.used);
}
function soldCount(productId) {
  return orders
    .filter((o) => o.productId === productId && (o.status === 'paid' || o.status === 'delivered'))
    .reduce((s, o) => s + o.qty, 0);
}
// 激活码商品库存 = 未用卡密数；其他商品库存 = items.json 库存 - 已售
function liveStock(it) {
  if (it.category === 'key') return unusedCards(it.id).length;
  return Math.max(0, it.stock - soldCount(it.id));
}
function publicItem(it) {
  return {
    id: it.id,
    name: it.name,
    game: it.game,
    category: it.category,
    categoryLabel: CATEGORIES[it.category] || it.category,
    price: it.price,
    stock: liveStock(it),
    emoji: it.emoji,
    color: it.color,
    desc: it.desc,
    platform: it.platform || null,
    region: it.region || null,
    sales: it.sales || 0,
    autoDeliver: it.category === 'key',
  };
}
// 发卡：先发真卡，再发演示卡
function dispenseCodes(productId, qty) {
  const pool = unusedCards(productId).sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0));
  if (pool.length < qty) return null;
  return pool.slice(0, qty);
}

// ---------------- 管理后台鉴权 ----------------
const adminTokens = new Map(); // token -> expiry ms
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const exp = token && adminTokens.get(token);
  if (exp && exp > Date.now()) return next();
  return res.status(401).json({ error: '请先登录管理后台' });
}

// ---------------- 公开接口 ----------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/public-settings', (req, res) => {
  res.json({
    shopName: settings.shopName,
    announcement: settings.announcement,
    contactQQ: settings.contactQQ,
    contactWechat: settings.contactWechat,
    hasQrWechat: !!settings.qrWechat,
    hasQrAlipay: !!settings.qrAlipay,
    autoDeliver: !!settings.autoDeliver,
  });
});

app.get('/api/items', (req, res) => {
  let list = items.map(publicItem);
  const { category, sort } = req.query;
  if (category && CATEGORIES[category]) list = list.filter((it) => it.category === category);
  if (sort === 'price_asc') list.sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') list.sort((a, b) => b.price - a.price);
  const counts = {};
  for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
  res.json({ items: list, categories: CATEGORIES, counts, total: items.length });
});

app.get('/api/items/:id', (req, res) => {
  const it = items.find((x) => x.id === req.params.id);
  if (!it) return res.status(404).json({ error: '商品不存在' });
  res.json(publicItem(it));
});

// 收款码图片（买家付款时用）
app.get('/api/pay-qr/:method', (req, res) => {
  const qr = req.params.method === 'wechat' ? settings.qrWechat
    : req.params.method === 'alipay' ? settings.qrAlipay : '';
  if (!qr) return res.status(404).json({ error: '店主尚未上传收款码，请联系客服' });
  res.json({ qr });
});

// ---------------- 下单 / 付款 / 查单 ----------------
// 下单：生成待付款订单（不扣库存、不发卡）
app.post('/api/orders', (req, res) => {
  const { productId, qty, email, payMethod } = req.body || {};
  const it = items.find((x) => x.id === productId);
  if (!it) return res.status(404).json({ error: '商品不存在' });
  const n = Math.max(1, parseInt(qty, 10) || 1);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: '请填写正确的联系邮箱，用于接收发货信息和查单' });
  }
  if (payMethod !== 'wechat' && payMethod !== 'alipay') {
    return res.status(400).json({ error: '请选择支付方式' });
  }
  if (liveStock(it) < n) {
    return res.status(400).json({ error: `库存不足，${it.name} 只剩 ${liveStock(it)} 件` });
  }
  const orderNo = 'XP' + Date.now().toString().slice(-10) + String(orderSeq++).padStart(2, '0') + Math.floor(Math.random() * 90 + 10);
  const order = {
    orderNo,
    productId: it.id,
    name: it.name,
    qty: n,
    unitPrice: it.price,
    total: it.price * n,
    email,
    payMethod,
    txid: '',
    status: 'pending', // pending 待付款 -> paid 待确认 -> delivered 已发货
    codes: [],
    createdAt: new Date().toISOString(),
    paidAt: null,
    deliveredAt: null,
  };
  orders.push(order);
  saveOrders();
  const qr = payMethod === 'wechat' ? settings.qrWechat : settings.qrAlipay;
  res.json({ orderNo, total: order.total, payMethod, qr: qr || null, qrMissing: !qr, autoDeliver: !!settings.autoDeliver });
});

// 买家点“我已付款”：可附交易单号后几位，方便店主对账
app.post('/api/orders/:orderNo/paid', (req, res) => {
  const o = orders.find((x) => x.orderNo === req.params.orderNo);
  if (!o) return res.status(404).json({ error: '订单不存在' });
  if (o.status !== 'pending') return res.status(400).json({ error: '该订单已处理，请在查单页查看状态' });
  o.txid = (req.body && req.body.txid) || '';
  o.paidAt = new Date().toISOString();
  o.status = 'paid';
  // 自动发货模式：直接发卡
  if (settings.autoDeliver) {
    const result = deliverOrder(o);
    if (result.error) { saveOrders(); return res.status(400).json({ error: result.error }); }
  }
  saveOrders();
  res.json(publicOrder(o));
});

// 发卡（内部）：激活码商品扣卡密，其他商品仅标记已发货、需客服联系发货
function deliverOrder(o) {
  const it = items.find((x) => x.id === o.productId);
  if (!it) return { error: '商品不存在' };
  if (it.category === 'key') {
    const picked = dispenseCodes(o.productId, o.qty);
    if (!picked) return { error: '卡密库存不足，请联系客服补货' };
    for (const c of picked) {
      c.used = true;
      c.orderNo = o.orderNo;
      c.usedAt = new Date().toISOString();
    }
    o.codes = picked.map((c) => ({ code: c.code, demo: !!c.demo }));
    saveCards();
  }
  o.status = 'delivered';
  o.deliveredAt = new Date().toISOString();
  return { ok: true };
}

function publicOrder(o) {
  return {
    orderNo: o.orderNo,
    name: o.name,
    qty: o.qty,
    total: o.total,
    payMethod: o.payMethod,
    status: o.status,
    codes: o.status === 'delivered' ? o.codes : [],
    isKey: (items.find((x) => x.id === o.productId) || {}).category === 'key',
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    deliveredAt: o.deliveredAt,
  };
}

// 查单：按订单号
app.get('/api/orders/:orderNo', (req, res) => {
  const o = orders.find((x) => x.orderNo === req.params.orderNo);
  if (!o) return res.status(404).json({ error: '订单不存在' });
  res.json(publicOrder(o));
});

// 查单：按邮箱列出订单（不含卡密）
app.get('/api/orders', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: '请填写下单邮箱' });
  const list = orders
    .filter((o) => o.email.toLowerCase() === email)
    .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1))
    .map((o) => ({
      orderNo: o.orderNo, name: o.name, qty: o.qty, total: o.total,
      status: o.status, createdAt: o.createdAt,
    }));
  res.json({ orders: list });
});

// ---------------- 管理后台 ----------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === settings.adminPass) {
    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.set(token, Date.now() + 24 * 3600 * 1000);
    return res.json({ token });
  }
  res.status(401).json({ error: '密码不对' });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const { status } = req.query;
  let list = [...orders].sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  if (status) list = list.filter((o) => o.status === status);
  res.json({ orders: list });
});

// 确认收款并发卡
app.post('/api/admin/orders/:orderNo/confirm', requireAdmin, (req, res) => {
  const o = orders.find((x) => x.orderNo === req.params.orderNo);
  if (!o) return res.status(404).json({ error: '订单不存在' });
  if (o.status === 'delivered') return res.json(publicOrder(o));
  if (o.status === 'cancelled') return res.status(400).json({ error: '订单已取消' });
  if (o.status === 'pending') return res.status(400).json({ error: '买家还没点“我已付款”，请先确认买家已付款' });
  const result = deliverOrder(o);
  if (result.error) return res.status(400).json({ error: result.error });
  saveOrders();
  res.json(publicOrder(o));
});

// 取消订单（待确认前可取消，不扣卡）
app.post('/api/admin/orders/:orderNo/cancel', requireAdmin, (req, res) => {
  const o = orders.find((x) => x.orderNo === req.params.orderNo);
  if (!o) return res.status(404).json({ error: '订单不存在' });
  if (o.status === 'delivered') return res.status(400).json({ error: '已发货订单不能取消' });
  o.status = 'cancelled';
  saveOrders();
  res.json(publicOrder(o));
});

// 卡密库存
app.get('/api/admin/cards', requireAdmin, (req, res) => {
  const { productId } = req.query;
  let list = [...cards].sort((a, b) => (a.used - b.used) || (a.demo - b.demo));
  if (productId) list = list.filter((c) => c.productId === productId);
  const byProduct = {};
  for (const it of items) {
    byProduct[it.id] = {
      name: it.name,
      total: cards.filter((c) => c.productId === it.id).length,
      unused: unusedCards(it.id).length,
      unusedReal: cards.filter((c) => c.productId === it.id && !c.used && !c.demo).length,
      unusedDemo: cards.filter((c) => c.productId === it.id && !c.used && c.demo).length,
    };
  }
  res.json({ cards: list, byProduct });
});

// 批量加卡密：一行一个
app.post('/api/admin/cards', requireAdmin, (req, res) => {
  const { productId, codes } = req.body || {};
  const it = items.find((x) => x.id === productId);
  if (!it) return res.status(404).json({ error: '商品不存在' });
  const lines = String(codes || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: '请粘贴卡密，一行一个' });
  let added = 0;
  for (const code of lines) {
    if (cards.some((c) => c.code === code)) continue; // 去重
    cards.push({
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      productId, code, demo: false, used: false, orderNo: null, usedAt: null,
    });
    added++;
  }
  saveCards();
  res.json({ added, total: cards.filter((c) => c.productId === productId).length });
});

// 删除一条未使用的卡密
app.delete('/api/admin/cards/:id', requireAdmin, (req, res) => {
  const idx = cards.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '卡密不存在' });
  if (cards[idx].used) return res.status(400).json({ error: '已发出的卡密不能删除' });
  cards.splice(idx, 1);
  saveCards();
  res.json({ ok: true });
});

// 清空某商品的演示卡密
app.post('/api/admin/cards/clear-demo', requireAdmin, (req, res) => {
  const { productId } = req.body || {};
  const before = cards.length;
  cards = cards.filter((c) => !(c.demo && !c.used && (!productId || c.productId === productId)));
  saveCards();
  res.json({ removed: before - cards.length });
});

// 设置（公告、客服、收款码 base64、自动发货、管理密码）
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({
    shopName: settings.shopName,
    announcement: settings.announcement,
    contactQQ: settings.contactQQ,
    contactWechat: settings.contactWechat,
    hasQrWechat: !!settings.qrWechat,
    hasQrAlipay: !!settings.qrAlipay,
    autoDeliver: !!settings.autoDeliver,
  });
});
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (typeof b.shopName === 'string') settings.shopName = b.shopName.slice(0, 30);
  if (typeof b.announcement === 'string') settings.announcement = b.announcement.slice(0, 2000);
  if (typeof b.contactQQ === 'string') settings.contactQQ = b.contactQQ.slice(0, 30);
  if (typeof b.contactWechat === 'string') settings.contactWechat = b.contactWechat.slice(0, 60);
  if (typeof b.qrWechat === 'string') settings.qrWechat = b.qrWechat.slice(0, 500000);
  if (typeof b.qrAlipay === 'string') settings.qrAlipay = b.qrAlipay.slice(0, 500000);
  if (typeof b.autoDeliver === 'boolean') settings.autoDeliver = b.autoDeliver;
  if (typeof b.adminPass === 'string' && b.adminPass.length >= 6) settings.adminPass = b.adminPass;
  saveSettings();
  res.json({ ok: true });
});

// 备份 / 恢复（重新部署会清空 data，请定期导出备份）
app.get('/api/admin/backup', requireAdmin, (req, res) => {
  res.json({ settings, cards, orders, items, exportedAt: new Date().toISOString() });
});
app.post('/api/admin/restore', requireAdmin, (req, res) => {
  const d = req.body || {};
  if (Array.isArray(d.cards)) { cards = d.cards; saveCards(); }
  if (Array.isArray(d.orders)) { orders = d.orders; saveOrders(); }
  if (d.settings && typeof d.settings === 'object') {
    settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
    saveSettings();
  }
  res.json({ ok: true, cards: cards.length, orders: orders.length });
});

app.listen(PORT, () => {
  console.log(`xiaopu auto-card shop running on port ${PORT}`);
});
