# 小铺子 · PUBG 游戏道具交易网站（演示站）

很小的 Node.js + Express 网站，无数据库、无构建步骤，专为 Abasthan 免费档（512MB 内存、0.1 vCPU）设计，足够轻量。

## 文件清单

| 文件 | 说明 |
|---|---|
| `package.json` | 依赖只有 express，启动命令 `npm start`（即 `node app.js`） |
| `app.js` | 服务端：静态页面 + API，监听 `process.env.PORT`（默认 3001） |
| `items.json` | 18 个商品数据（10 个 PUBG 道具 + 8 个 Steam 激活码） |
| `public/index.html` | 前端单页：仿发卡网版式（分类、商品网格、详情、下单弹窗、扫码付款、查单） |
| `public/admin.html` | 店主管理后台：订单确认、卡密库存、收款码、公告客服、备份 |
| `data/` | 卡密库存 / 订单 / 设置（不进代码仓库，见 .gitignore） |
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
- `GET /api/items?category=key&sort=price_asc` 商品列表（分类筛选、价格排序）
- `GET /api/items/:id` 商品详情
- `POST /api/orders` 下单（生成待付款订单，返回订单号与收款码）
- `POST /api/orders/:orderNo/paid` 买家点“我已付款”
- `GET /api/orders/:orderNo` 查订单（含已发卡密）
- `GET /api/orders?email=...` 按邮箱查单
- `GET /api/health` 健康检查
- `/admin.html` 店主管理后台（订单确认、卡密库存、收款码、备份）

卡密库存、订单和设置存在服务器 data/ 文件里，不进代码仓库；重新部署会清空，请在管理后台定期导出备份。

## 部署到 Abasthan

在仪表板新建 Web Service，选公共 Git 仓库或直接上传代码，运行环境 Node.js 22，构建命令留空或 `npm install`，启动命令 `npm start`。平台会注入 `PORT` 环境变量，应用自动监听。

注意：本站出售虚拟数字商品（游戏道具、Steam 激活码），下单不产生实物交易与物流发货。

<!-- deploy: push script v2 (Git Data API, one commit per push) -->
