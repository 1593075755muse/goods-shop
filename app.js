// 小小的 PUBG 游戏道具交易网站（演示站）
// 无数据库、无构建步骤，商品在 items.json，购物车和订单放内存里。
// 部署到 Abasthan 免费档：Node 22，启动命令 npm start（node app.js）。
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'items.json'), 'utf8'));

const CATEGORIES = {
  skin: '武器皮肤',
  crate: '补给箱',
  outfit: '服装',
  emote: '表情',
};

// 购物车和订单都放内存，不持久化
const cart = new Map(); // id -> qty
const orders = []; // { orderNo, items, total, buyer, createdAt }
let orderSeq = 1;

function publicItem(it) {
  return {
    id: it.id,
    name: it.name,
    game: it.game,
    category: it.category,
    categoryLabel: CATEGORIES[it.category] || it.category,
    price: it.price,
    stock: it.stock,
    emoji: it.emoji,
    color: it.color,
    desc: it.desc,
  };
}

function cartDetail() {
  const list = [];
  let total = 0;
  for (const [id, qty] of cart) {
    const it = items.find((x) => x.id === id);
    if (!it) continue;
    const subtotal = it.price * qty;
    total += subtotal;
    list.push({ id: it.id, name: it.name, price: it.price, qty, subtotal, emoji: it.emoji });
  }
  return { items: list, total };
}

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 商品列表：?category=skin&sort=price_asc|price_desc
app.get('/api/items', (req, res) => {
  let list = items.map(publicItem);
  const { category, sort } = req.query;
  if (category && CATEGORIES[category]) {
    list = list.filter((it) => it.category === category);
  }
  if (sort === 'price_asc') list.sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') list.sort((a, b) => b.price - a.price);
  res.json({ items: list, categories: CATEGORIES });
});

// 商品详情
app.get('/api/items/:id', (req, res) => {
  const it = items.find((x) => x.id === req.params.id);
  if (!it) return res.status(404).json({ error: '商品不存在' });
  res.json(publicItem(it));
});

// 查看购物车
app.get('/api/cart', (req, res) => res.json(cartDetail()));

// 加购物车：{ id, qty }
app.post('/api/cart', (req, res) => {
  const { id, qty } = req.body || {};
  const it = items.find((x) => x.id === id);
  if (!it) return res.status(404).json({ error: '商品不存在' });
  const n = Math.max(1, parseInt(qty, 10) || 1);
  const cur = cart.get(id) || 0;
  if (cur + n > it.stock) {
    return res.status(400).json({ error: `库存不足，${it.name} 只剩 ${it.stock} 件` });
  }
  cart.set(id, cur + n);
  res.json(cartDetail());
});

// 从购物车移除一件
app.delete('/api/cart/:id', (req, res) => {
  cart.delete(req.params.id);
  res.json(cartDetail());
});

// 清空购物车
app.post('/api/cart/clear', (req, res) => {
  cart.clear();
  res.json(cartDetail());
});

// 下单（演示，不接真支付）
app.post('/api/orders', (req, res) => {
  const detail = cartDetail();
  if (detail.items.length === 0) {
    return res.status(400).json({ error: '购物车是空的' });
  }
  // 扣库存
  for (const line of detail.items) {
    const it = items.find((x) => x.id === line.id);
    if (!it || it.stock < line.qty) {
      return res.status(400).json({ error: `库存不足，${line.name} 只剩 ${it ? it.stock : 0} 件` });
    }
  }
  for (const line of detail.items) {
    items.find((x) => x.id === line.id).stock -= line.qty;
  }
  const orderNo = 'GD' + String(Date.now()).slice(-8) + String(orderSeq++).padStart(2, '0');
  const order = {
    orderNo,
    items: detail.items,
    total: detail.total,
    buyer: (req.body && req.body.buyer) || '游客',
    createdAt: new Date().toISOString(),
    demo: true,
  };
  orders.push(order);
  cart.clear();
  res.json({
    orderNo,
    total: order.total,
    message: '下单成功！演示订单，未真实付款',
    note: '演示订单，未真实付款',
  });
});

// 查订单
app.get('/api/orders/:orderNo', (req, res) => {
  const o = orders.find((x) => x.orderNo === req.params.orderNo);
  if (!o) return res.status(404).json({ error: '订单不存在' });
  res.json(o);
});

app.listen(PORT, () => {
  console.log(`goods-shop running on port ${PORT}`);
});
