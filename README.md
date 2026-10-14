# UniCal · 对话式日历助手

用自然语言帮你安排日程、拆解长期目标，并直接写入飞书日历的 Web 应用。

> 例如：对它说「下周六晚上 7 点约小王吃饭」「我想一个月瘦五斤」，它会自动解析时间、检测日历冲突、推荐空闲时段、把抽象目标拆成可执行日程，确认后一键写入你的飞书主日历。

## ✨ 功能特性

- **自然语言排程**：支持明确安排（指定日期/时间）与模糊时间（「下午」「最近」），自动推荐真实空闲时段。
- **抽象目标拆解**：把「瘦五斤」「学会吉他」这类目标，先产出简版方案，确认后再生成具体日程；支持反复修改方案。
- **飞书日历深度集成**：OAuth 用户授权、忙闲查询、冲突标红、周期日程（RRule）、幂等写入。
- **场景化时段推荐**：内置餐饮 / 会议 / 运动 / 娱乐等场景时段知识库，区分午餐与晚餐、规避午休与深夜等红线。
- **流式对话**：SSE 逐字输出；明确安排等高频场景走本地规则模板，响应秒级且不消耗模型 token。
- **多用户**：每个用户用自己的飞书身份登录，数据隔离；支持用户在设置页填入**自带 LLM Key**，各自承担模型费用。
- **持久化与安全**：SQLite 持久化，飞书 token 使用 AES-256-GCM 加密存储，httpOnly Cookie 会话 + CSRF 校验。

## 🧱 技术栈

- [Next.js 14](https://nextjs.org/)（App Router）+ TypeScript
- Tailwind CSS
- better-sqlite3（持久化）
- 飞书开放平台 OpenAPI（日历 + OAuth v2）
- 任意 OpenAI 兼容的 LLM 网关（可选，未配置时回退内置规则引擎）

## 📁 目录结构

```
src/
├── app/                 # Next.js App Router：页面与 API 路由
│   ├── page.tsx         # 主界面（对话 + 右侧方案/候选/结果面板）
│   └── api/             # auth / session / calendar / user settings
├── components/          # UI 组件（日历视图、候选列表、主题、LLM 设置等）
├── core/                # 业务核心（纯逻辑）
│   ├── engine.ts        # 对话状态机
│   ├── nlu.ts           # 意图识别 / 时间抽取（规则快路径）
│   ├── llm-client.ts    # LLM Prompt 与 JSON 调用
│   ├── planner.ts       # 目标 → 方案 → 日程
│   ├── narrate.ts       # 对话叙述层（模板直出 / LLM 流式）
│   ├── conflict.ts      # 冲突检测
│   └── types.ts         # 类型定义
├── adapters/
│   ├── calendar/        # 日历适配器：feishu.ts / mock.ts
│   └── llm.ts           # OpenAI 兼容 LLM 客户端
└── server/              # 鉴权、加密、数据库、仓储、飞书 OAuth
scripts/prompt-test.mjs  # 绕过构建直接验证 Prompt 的独立脚本
```

## 🚀 快速开始

### 1. 环境要求

- Node.js **18+**（推荐 20）
- npm
- 安装 better-sqlite3 时若需本地编译，macOS 需 Xcode Command Line Tools：`xcode-select --install`

### 2. 获取代码并安装依赖

```bash
git clone https://github.com/CadoreZ4/unical.git
cd unical
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少需要填写 **飞书应用凭证** 和 **加密密钥**：

```env
# 必填：飞书自建应用（在开放平台「凭证与基础信息」获取）
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx
FEISHU_REDIRECT_URI=http://localhost:3001/api/auth/callback

# 必填：32 字节十六进制加密密钥
# 生成方法：在终端执行  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=把上面命令生成的 64 位字符串粘贴到这里

# 可选：LLM（不填则仅使用内置规则引擎，抽象目标拆解能力受限）
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxxx
LLM_MODEL=deepseek-chat
```

> 完整变量说明见 [.env.example](./.env.example)。

### 4. 在飞书开放平台创建应用

1. 打开 [飞书开放平台](https://open.feishu.cn) → 创建**企业自建应用**。
2. 「凭证与基础信息」中复制 **App ID / App Secret**，填入 `.env.local`。
3. 「权限管理」开通以下权限：
   - `calendar:calendar:read`（获取日历信息）
   - `calendar:calendar.event:read`（读取日程）
   - `calendar:calendar.event:create`（创建日程）
   - `calendar:calendar.free_busy:read`（读取忙闲）
   - `offline_access`（获取 refresh_token，长效登录必需）
4. 「安全设置 → 重定向 URL」新增（与 `.env.local` 完全一致）：
   ```
   http://localhost:3001/api/auth/callback
   ```

### 5. 启动

```bash
PORT=3001 npm run dev
```

打开 http://localhost:3001 ，点击右上角「连接飞书」完成授权即可使用。

其他命令：

```bash
npm run build     # 生产构建
npm start         # 运行生产构建（配合 PORT=3001）
npm run lint      # 代码检查
node scripts/prompt-test.mjs   # 独立验证 LLM Prompt（需先配好 LLM 环境变量）
```

## 🔌 配置自有 LLM（可选）

应用支持任意 **OpenAI 兼容**接口，例如：

| 服务商 | LLM_BASE_URL | 示例模型 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| 火山方舟（豆包） | `https://ark.cn-beijing.volces.com/api/v3` | 你的接入点 ID |
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat:free` |

两种配置方式：

- **全局**：在 `.env.local` 中配置，所有用户共用。
- **用户自带 Key**：应用右上角 ⚙️ 设置中填写，该用户的模型调用走自己的 Key（AES-256-GCM 加密存储）。

未配置 LLM 时，明确时间的安排仍可通过内置规则引擎正常使用。

## ☁️ 部署

仓库已包含容器化与平台部署文件：

- `Dockerfile`：多阶段构建，已处理 better-sqlite3 原生编译。
- `docker-compose.yml`：VPS 一键部署，自动挂载 SQLite 数据卷。
- `railway.toml`：[Railway](https://railway.app) 部署配置。

Docker Compose 部署：

```bash
# 在 .env 中填好环境变量后
docker compose up -d --build
```

部署到线上后，记得：

1. 把反向代理 / 平台的线上 HTTPS 回调地址加入飞书「重定向 URL」，例如
   `https://你的域名/api/auth/callback`，并同步更新 `FEISHU_REDIRECT_URI`。
2. 为 `/app/data` 挂载持久卷，避免重启丢失 SQLite 数据。
3. 若用 Nginx 反向代理，关闭对 SSE 路由的缓冲（`proxy_buffering off;`）。

## 🔒 安全说明

- `.env.local` 与 `data/`（数据库）已在 `.gitignore` 中，**不会**提交到仓库。
- 飞书 access_token / refresh_token、用户自带 LLM Key 均使用 AES-256-GCM 加密后落库。
- 生产环境务必设置强随机的 `ENCRYPTION_KEY`。
- 企业自建应用默认仅本企业成员可授权；如需开放给企业外部用户，需在飞书开放平台走应用发布/上架流程。

## 📄 License

本项目未指定开源协议，默认保留所有权利。如需开源，建议补充 `LICENSE` 文件（如 MIT）。
