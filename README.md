# 集中管理系统（报价 / 合同 / 送货单）

> 当前版本：**v1.3**（2026-11-28）

把原来三个「单文件 HTML + 浏览器 localStorage」工具的数据，统一收拢到一台服务器上：
**一套客户档案、一套货品库、一条报价 → 合同 → 送货单的业务链、一个文件库、一套账号权限**。
任何一台电脑登录同一个地址，看到的都是同一份数据。

- 后端：Node.js 22 + 内置 `node:sqlite`（零第三方依赖，不需要 npm install）
- 前端：原生 ES Module 单页（无构建步骤，改完刷新即生效）
- 部署：Windows 直接 `node server.js`；NAS / 服务器用 Docker，数据挂载到 `./data`

---

## 一、为什么选 Node.js

| 方案 | 结论 |
|---|---|
| **Node.js + SQLite（本项目）** | 和三个旧工具同为 JavaScript，金额大写、A4 版式、打印逻辑可以原样搬；前后端一套语言；Node 22 自带 SQLite，单进程 + 单目录就能跑；NAS / Windows 都合适 |
| Python + FastAPI | 也能做，但前后端两套语言、两套依赖，单人维护成本高 |
| Java / Spring Boot | 对这套「几个人用、一天几十张单」的体量太重，部署要 JVM + 数据库 |
| PHP | 传统表单友好，但实时明细行、打印预览这类交互要另写大量 JS |
| Go | 性能好，但开发速度慢，且打印/表格类前端仍要 JS，等于两套语言 |

**结论：Node.js（JavaScript 全栈）+ SQLite 起步。**
现在的数据量（客户几百家、单据几千张）SQLite 完全够用；以后真要上多人高并发，`src/db.js` 是唯一的数据访问层，换 PostgreSQL 不用改业务代码。

---

## 二、功能

**游客模式（默认，无需登录）**
- 打开系统直接进完整管理界面，报价单 / 销售合同 / 送货单、客户档案、货品库、单据列表、文件库都能用，系统内置的公司 Logo 与电子章也能直接加盖
- 游客身份由持久化 cookie `gid` 标识（一年有效），服务端为它建一个临时 `guest` 账号；单据、客户、货品、文件都写进**同一套服务器数据库**，与登录账号共享，不是浏览器本地草稿
- 游客数据按 `owner_id` 记为这个游客；登录时把这些单据、文件、客户来源一次性转移到账号，并清掉 `gid` cookie
- **同一份游客数据只合并一次**：账号一合并后，该游客身份已删除；同一浏览器再登录账号二不会重复合并，数据归属仍是账号一，清 cookie 也不会丢
- 账号管理、系统设置这类管理员入口仍只在登录后出现

**账号与权限**
- 登录、改密、启停账号；管理员 / 主管 / 业务员三种角色
- 业务员可开单、改单；主管可删除、导入；管理员另可管账号与公司主体

**客户档案**
- 新增 / 编辑 / 搜索；名称、联系人、电话、传真、地址、税号、备注
- 开单时输入客户名自动建档、自动补全联系方式；客户详情页汇总全部往来单据与合同金额

**货品库**
- 品名 + 规格型号 + 单位 + 参考单价；开单时在「规格型号」输入即带出品名与单价
- 明细填齐后自动入库，三套单据共用

**单据中心**
- 报价单 / 销售合同 / 送货单，各自独立编号与状态
- 编号规则：`公司代码-类型-日期-序号`，例如
  `JXT-BJ-20261127-001`（报价）、`JXT-HT-20261127-001`（合同）、`JXT-XS-20261127-001`（送货）
  送货单按单据类型自动换 `XS`（送货）/ `DB`（样品）/ `TQ`（提前送货）
- 明细支持 Excel 粘贴、行增删、合计与人民币大写
- A4 打印视图，浏览器「打印 / 另存为 PDF」；公司 Logo 与电子章自动带入，游客与登录账号一样可直接使用

**三单联动（核心）**
- 报价单 → 一键「转合同」：客户、地址、联系人、电话、明细、税率、备注全部带过去
- 合同 → 一键「转送货单」：客户与明细带过去，并写入关联合同号
- 单据详情页顶部有完整链路：`报价单 → 合同 → 送货单`，点任意节点跳转
- 工作台自动列出「报价未转合同」「合同未送货」的待跟进单据

**文件库**
- 单据附件（合同扫描件、发票、送货回单）、公司 Logo、电子章
- 上传、在线查看、下载、按类别筛选；文件落盘在 `data/files/年-月/`，元数据在数据库

**旧数据迁移**
- 系统设置里直接导入三个旧工具导出的 JSON 备份，客户 / 货品 / 单据去重导入

---

## 三、快速开始（Windows）

1. 确认 Node.js ≥ 22.13（内置 SQLite 默认开启）：`node -v`
2. 双击 `启动.bat`，或命令行：
   ```powershell
   cd D:\dbwork\集中管理系统
   node server.js
   ```
3. 浏览器打开 http://localhost:8099
4. 默认管理员 **admin / admin123**，登录后到「系统设置 → 修改我的密码」

数据目录默认是项目下的 `data/`（可用环境变量 `DATA_DIR` 指定）：

```
data/
├── app.db          SQLite 数据库（用户、客户、货品、单据、文件元数据）
├── secret.key      登录令牌签名密钥（自动生成，勿外传）
└── files/          上传的文件（按 年-月 分目录）
```

---

## 四、Docker / NAS 部署

```bash
# 把整个目录放到 NAS（如 /vol1/1000/docker/jizhong）
cd /vol1/1000/docker/jizhong
docker compose up -d --build
# 打开 http://NAS的IP:8099
```

`docker-compose.yml` 已把 `./data` 挂到容器 `/app/data`，重建容器数据不丢。
端口 8099，和旧的 8090（报价单）/ 8091（合同）/ 8088（送货单）不冲突，可以并存过渡。

生产建议在 compose 里固定 `APP_SECRET`（任意长随机串），否则重建容器会让所有人重新登录一次。

---

## 五、备份

只需要备份 `data/` 整个目录：

```powershell
# Windows 示例：停服后复制
Compress-Archive -Path .\data -DestinationPath "D:\backup\jizhong-$(Get-Date -Format yyyyMMdd).zip"
```

- 数据库是单文件 `app.db`（WAL 模式，运行中复制请连同 `app.db-wal`、`app.db-shm` 一起）
- 文件是普通文件，直接拷 `data/files`
- 恢复：把 `data/` 放回原位再启动即可

---

## 六、目录结构

```
集中管理系统/
├── server.js              启动入口（HTTP 服务、静态页、API 分发）
├── src/
│   ├── config.js          端口、数据目录、密钥
│   ├── db.js              建表、种子数据、查询封装
│   ├── auth.js            登录令牌、角色校验、审计
│   ├── password.js        scrypt 密码哈希
│   ├── router.js          极简路由（:id 参数、权限）
│   ├── multipart.js       文件上传解析
│   ├── service.js         单据编号、客户/货品自动建档、上传落盘
│   ├── static.js          前端静态托管
│   ├── api.js             API 入口
│   └── routes/            auth / users / base / documents / files / dashboard / import
├── web/
│   ├── index.html
│   └── assets/
│       ├── app.css
│       ├── app.js              入口：登录、游客身份、路由表
│       └── js/                 core / shell / editor / print / pages/*
├── data/                  运行时数据（不入库）
├── Dockerfile
├── docker-compose.yml
├── 启动.bat
└── docs/系统设计.md        三个旧项目的分析、架构与数据模型说明
```

---

## 七、权限矩阵

| 操作 | 管理员 | 主管 | 业务员 | 游客 |
|---|---|---|---|---|
| 查看 / 新建 / 编辑单据 | ✓ | ✓ | ✓ | ✓ |
| 删除单据 | ✓ | ✓ | ✗ | ✓ |
| 客户、货品增改 | ✓ | ✓ | ✓ | ✓ |
| 删除客户 / 货品 | ✓ | ✓ | ✗ | ✗ |
| 文件上传 / 查看 | ✓ | ✓ | ✓ | ✓ |
| 删除文件 | ✓ | ✓ | ✗ | ✓ |
| 导入旧数据 | ✓ | ✓ | ✗ | ✗ |
| 修改公司主体 / Logo / 电子章 | ✓ | ✓ | ✗ | ✗ |
| 用户管理 | ✓ | ✗ | ✗ | ✗ |

游客与登录账号共用一套客户、货品、单据、文件；区别只是身份和合并归属。

---

## 八、主要接口

所有接口以 `/api` 开头。除登录、`/api/auth/guest`、`/api/public/bootstrap` 外，都需要身份：登录用户用 `Authorization: Bearer <token>`，游客用持久化 cookie `gid`（也可用 `?token=` 传登录 token）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录；若带游客 cookie，合并游客单据/文件/客户来源（仅一次） |
| GET | `/api/auth/guest` | 免登录游客：发/复用持久化 cookie `gid`，返回临时游客身份 |
| GET | `/api/auth/me` | 当前用户 |
| PUT | `/api/auth/password` | 改密 |
| GET/POST/PUT/DELETE | `/api/users` | 用户管理（管理员） |
| GET | `/api/companies` | 公司主体 |
| PUT | `/api/companies/:id` | 修改主体（主管以上） |
| POST | `/api/companies/:id/logo\|stamp` | 上传 Logo / 电子章 |
| GET/POST/PUT/DELETE | `/api/customers` | 客户档案 |
| GET/POST/PUT/DELETE | `/api/products` | 货品库 |
| GET | `/api/documents` | 单据列表（type/status/q/日期/分页） |
| POST/PUT/DELETE | `/api/documents` | 新建 / 修改 / 删除 |
| POST | `/api/documents/:id/convert` | `{ "to": "contract" \| "delivery" }` 派生下游单据 |
| POST | `/api/documents/:id/status` | 状态流转 |
| GET | `/api/documents/:id/chain` | 关联链路 |
| POST | `/api/documents/:id/files` | 上传附件（multipart） |
| POST | `/api/files` | 上传到文件库 |
| GET | `/api/files/:id/raw\|download` | 查看 / 下载 |
| GET | `/api/dashboard` | 工作台统计 |
| GET | `/api/export/backup` | 导出结构化数据 JSON（主管以上） |
| POST | `/api/import/legacy` | 导入旧工具备份 JSON |

---

## 九、和旧工具的关系 / 当前边界

三个旧项目（`SalesContract` 销售合同、`Contract-Generator` 报价单、`delivery-note-generator` 送货单）继续保留，可作为「断网应急」的单机版；日常统一用本系统。

当前版本覆盖了开单、联动、打印、客户/货品/文件/账号管理，**暂未搬运**的旧功能：

- 明细表列宽拖拽、三块字号微调（版式目前是固定的一套）
- 直接导出可编辑 `.docx`（现在走浏览器打印 / 另存 PDF）
- 送货单 241×140 三联纸的专用版式（现在是 A4，针式打印机可用 A4 纸或后续加三联模板）
- 电子章的上传去白底处理（现在是上传原图直接用，建议上传已去底的 PNG）

这些都在 `docs/系统设计.md` 的「后续演进」里列了优先级。

---

## 十、常见问题

**打不开页面**：确认 `node server.js` 窗口还在、8099 端口未被占用（`netstat -ano | findstr 8099`）。

**忘记管理员密码**：停服后执行
```powershell
node tools/reset-password.js admin 你的新密码
```
（至少 6 位；会同时把该账号恢复为启用状态。不要删 `app.db`，那会把所有数据一起删掉。）

**打印出来有空白第二页**：打印面板里纸张选 A4、缩放 100%、边距「无」、关闭页眉页脚。

**同事看不到我上传的章**：章存在服务器（公司主体里），所有人共用；旧工具是存在各自浏览器里的，这点已经改了。

---

## 十一、版本历史

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.3 | 2026-11-28 | 前端按页面拆分为原生 ES Module：`app.js` 从 1858 行缩减为 136 行入口，新增 `js/core.js`、`shell.js`、`editor.js`、`print.js` 与 `pages/*`；删除废弃的本地游客逻辑，清理旧游客样式；三单、打印、游客共享与一次性合并逻辑保持不变 |
| v1.2 | 2026-11-28 | 游客模式改为服务端持久身份（cookie `gid` + 临时 `guest` 账号），登录时一次性合并游客数据；开放游客删单/删文件；权限矩阵与接口文档同步 |
| v1.1 | 2026-11-27 | 首个版本：报价单 / 销售合同 / 送货单三单联动、客户货品档案、文件库、账号权限、Docker 部署 |
