# 小铺子 · PUBG 游戏道具交易网站（演示站）

很小的 Node.js + Express 网站，无数据库、无构建步骤，专为 Abasthan 免费档（512MB 内存、0.1 vCPU）设计，足够轻量。

## 文件清单

| 文件 | 说明 |
|---|---|
| `package.json` | 依赖只有 express，启动命令 `npm start`（即 `node app.js`） |
| `app.js` | 服务端：静态页面 + API，监听 `process.env.PORT`（默认 3001） |
| `items.json` | 10 个 PUBG 商品数据（武器皮肤、补给箱、服装、表情） |
| `public/index.html` | 前端单页：商品列表、分类筛选、价格排序、详情、购物车、下单 |
| `README.md` | 本文件 |

## 本地启动

```bash
cd ~/workspace/goods-shop
npm install
npm start
```

打开 http://localhost:3001 即可。

## 接口

- `GET /` 首页（商品列表）
- `GET /api/items?category=skin&sort=price_asc` 商品列表（分类筛选、价格排序）
- `GET /api/items/:id` 商品详情
- `GET /api/cart` 查看购物车
- `POST /api/cart` 加购物车 `{ id, qty }`
- `DELETE /api/cart/:id` 从购物车移除
- `POST /api/orders` 下单（演示，不接真实支付，返回订单号）
- `GET /api/orders/:orderNo` 查订单
- `GET /api/health` 健康检查

购物车和订单放服务器内存里，不持久化，重启即清空。

## 部署到 Abasthan

在仪表板新建 Web Service，选公共 Git 仓库或直接上传代码，运行环境 Node.js 22，构建命令留空或 `npm install`，启动命令 `npm start`。平台会注入 `PORT` 环境变量，应用自动监听。

注意：本站是演示站，下单不产生真实交易与付款；也不要用来跑 VPN/代理（平台条款禁止）。
