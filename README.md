# Branchcraft

中文（默认） | [English](README.en.md)

基于 Electron 与原生 JavaScript 的本地 Git 可视化桌面工作台，直接调用本机 Git，面向 Windows、Linux 与 macOS。开发主线为 `main`。

## 功能

- **项目文件**：浏览已跟踪与未忽略的未跟踪文件；编辑 UTF-8 文本，与 HEAD 或暂存区比较。Ctrl+S 仅保存工作区，不自动暂存。
- **工作区与提交**：文件夹分组展示已暂存、未暂存、冲突与未跟踪内容；文件/全部暂存与取消暂存，受支持文本可按代码块操作；提交前审阅 Diff，说明草稿按仓库保存在本机。
- **历史与分支**：最近 180 条提交、父子关系图、标签和补丁；创建/切换本地分支，从远程分支显式创建跟踪分支，合并与中止合并。
- **远程与 Stash**：Fetch、快进 Pull、普通 Push；储藏列表/补丁、保存、应用、恢复并移除、确认后删除。默认包含未跟踪文件，不包含忽略文件；应用冲突时保留储藏，不保证恢复原暂存状态（未使用 `--index`）。
- **冲突处理**：查看基线/当前/传入文本，编辑结果、保存并暂存。
- **工作流**：外部变化自动刷新，也可 F5/手动刷新；未暂存内容按文件/代码块回退，本地恢复记录提供有限安全网。
- **持续终端**：右侧 PTY 保留 Shell、目录与进程状态，支持输入、Ctrl+C、调整尺寸；隐藏不结束会话，切换仓库、重载或关窗会清理旧会话。

## 快速开始：源码开发

需要 **Node.js 24、npm 11、Git**（Windows 使用 Git for Windows），并能在终端执行 `git --version`。

```powershell
git clone --branch main https://github.com/MannixYang/Branchcraft.git
cd Branchcraft
npm ci
npm start
```

以上可在 PowerShell 执行；若执行策略阻止 `npm.ps1`，使用 `npm.cmd`。Linux/macOS 在终端使用相同 npm 命令。打开应用后选择**已有 Git 仓库**；应用不负责初始化仓库或配置全局 Git 身份。

`npm ci` 检查 node-pty 的完整目标 N-API 预构建；缺少时安装/编译原生依赖。Linux 需要 Python、make 和 C/C++ 编译器；其他平台缺少预构建时也需相应工具链。不要全局禁用原生编译。

### 开发运行与发布包的区别

- `npm start` 从当前源码运行，需要 Node.js 与 npm。
- 发布包自带 Electron，无需另装 Node.js，但**仍需要系统 Git**。portable 仅表示免安装，设置/恢复数据仍写入系统用户目录。
- `npm run pack` 只更新当前平台的**目录包**（Windows 为 `release/win-unpacked`），**不会更新已有 portable EXE 或安装器**。
- `npm run dist` 生成当前平台发行文件；显式目标为 `npm run dist:win`、`npm run dist:linux`、`npm run dist:mac`，输出位于 `release/`。macOS 构建应在 macOS 上进行。

## 源码目录与资源放置

```text
Branchcraft/
├─ src/
│  ├─ main/
│  │  ├─ index.js
│  │  ├─ git-service.js
│  │  ├─ project-service.js
│  │  ├─ terminal-service.js
│  │  ├─ repo-watcher.js
│  │  ├─ recovery-store.js
│  │  └─ platform.js
│  ├─ preload/
│  │  └─ index.js
│  ├─ renderer/
│  │  ├─ index.html
│  │  ├─ renderer.js
│  │  ├─ project-ui.js
│  │  ├─ terminal-ui.js
│  │  └─ styles.css
│  └─ shared/
│     └─ file-tree.js
├─ scripts/
├─ test/
├─ .github/
├─ Dockerfile.validation
└─ package.json
```

- `src/main/`：Electron 生命周期、IPC 路由与 Git、项目文件、PTY、监听、恢复和平台服务；入口 `index.js` 由原根 `main.js` 迁入。
- `src/preload/index.js`：由原 `preload.js` 迁入，只暴露受限 API 与事件订阅。
- `src/renderer/`：HTML、CSS 与界面逻辑；新增页面、界面脚本及样式放在此处。
- `src/shared/file-tree.js`：浏览器与 Node 测试共用的 UMD 纯逻辑；新增共享模块须兼容两种环境，不引入 Electron/DOM 副作用。
- `scripts/`、`test/`、根 `Dockerfile.validation` 与 `.github/` 保持原位置；新增构建脚本、测试和工作流分别放入对应目录。
- `package.json.main` 为 `src/main/index.js`，`build.files` 为 `src/**/*` 与 `package.json`；依赖仍由打包工具处理。
- 相对路径以引用文件为准，不是项目根或当前工作目录：主进程从自身 `__dirname` 定位 `../preload/index.js`、`../renderer/index.html`；HTML 的本地 CSS/脚本在同目录，共享脚本为 `../shared/file-tree.js`，依赖资源为 `../../node_modules/...`；`test/` 引入共享模块使用 `../src/shared/file-tree.js`。CSS 的 `url(...)` 相对样式文件。移动后同步检查引用、测试与打包路径。
- 根目录没有受控图标/字体资源，不创建空 `assets/`。确需新静态资源时再放入 `src/renderer/assets/`，同步引用、许可和打包检查。旧日志、截图、`release/`、`node_modules/` 是忽略产物，不作为迁移或删除对象。

## v1.0.0 预发布流程

开发主线为 `main`。以下描述自动发布规则；实际构建与发布状态请查看 GitHub Actions 和 Releases，不应将配置存在视为验证通过。

推送与 `package.json` 版本一致的 `v1.0.0` 标签后，`.github/workflows/build.yml` 要求 Windows x64、Linux x64、macOS x64、macOS arm64 四个平台的单元测试、源码桌面测试、打包及打包版桌面测试全部通过，才自动发布 GitHub **Pre-release**，设置 `make_latest: false`（不设 Latest）。分支构建本身不发布。

附件为 **8 个发行包 + `SHA256SUMS.txt`**：Windows 安装器/portable EXE、Linux AppImage/deb、macOS x64 DMG/ZIP、macOS arm64 DMG/ZIP。流程先建草稿、上传全部附件，再公开预发布；请核对校验和。当前包未签名，macOS 未经 Apple 公证，系统可能提示风险；先在测试仓库体验。目录包 smoke 不等同于安装器或 portable 启动器验收。

## 系统与实测范围

| 平台 | 配置的发行目标 | 本轮实机范围 |
| --- | --- | --- |
| Windows x64 | NSIS 安装器、portable EXE | 当前使用与验证平台；源码及新目录包，不等同于安装器/portable 已验证 |
| Linux x64 | AppImage、deb | **未完成本轮实机验证** |
| macOS x64 / arm64 | DMG、ZIP | **未完成本轮实机验证** |

构建配置、Docker 验证脚本与 `.github/workflows/build.yml` 不代表云端 CI 或对应系统已通过验收；本说明不声称云端 CI、安装器或 portable 启动器已验证。

Linux 需桌面运行库（如 GTK3/NSS/GBM）；AppImage 可能需要执行权限与 FUSE。不要以 root 运行桌面应用或用 `--no-sandbox` 绕过正常权限问题。当前未配置 Windows 发布者签名或 Apple 签名/公证，请仅运行可信来源产物；系统可能拦截或提示风险。

## 安全与限制

- **真实仓库操作**：重要修改先提交或独立备份。避免其他 Git 客户端同时写同一仓库；自动刷新不是跨进程锁。复杂多分支历史图可能重叠。
- **Git 配置与认证**：沿用本机姓名、邮箱、远程、SSH 密钥/agent 与凭据管理器；无内置账户登录。Git 交互式密码提示已禁用，请先在终端配置认证。GUI 不一定继承终端自定义 SSH 环境；可用 `BRANCHCRAFT_GIT` 指定 Git 可执行文件绝对路径（不附命令参数）。
- **远程边界**：Pull 固定 `--ff-only`，分叉时拒绝；Push 使用 Git 默认远程/上游，新分支可能需先在终端设置上游。本地 bare 仓库测试不代表第三方网络/认证已验证。界面不提供 clone、交互式 rebase 或 force push。
- **代码块与回退**：普通已跟踪 UTF-8 文本支持块暂存/取消暂存；新增、删除、重命名、模式变化、冲突、二进制及超限内容回到文件级操作或外部工具。不提供逐行选择。块操作校验预览 token，变化后须重新预览；未暂存回退不改暂存区。Git 相似度识别可能把重命名显示为删除+新增。
- **编辑与冲突**：项目/冲突编辑限 2MiB 普通 UTF-8 文本；不支持的二进制、删除/修改或特殊重命名冲突请用外部工具后刷新。项目编辑不跟随符号链接，保存时校验外部变化 token；并非跨进程原子比较交换，仍应避免并发编辑。暂存区/HEAD 改变须重新审阅提交。
- **容量与超时**：未跟踪预览、代码块文件/差异有 2MiB 限制；Git 输出缓存上限 24MiB，单次命令超时 120 秒。
- **PTY 不是沙箱**：Windows 使用 PowerShell，Linux/macOS 使用登录 Shell；能执行真实系统命令，不逐条确认危险操作。Git hook 和终端命令同样需要信任。
- **本地恢复不是完整备份**：仅为支持的工作区回退/恢复保存原始字节，备份失败会拒绝破坏性操作；不覆盖所有操作（如 Stash 删除、合并中止），不替代提交或独立备份。恢复不改暂存区，恢复前再次备份当前状态。
- 恢复记录位于 Electron `userData/recovery`，所有仓库共享 **7 天、100MiB** 上限（含 JSON/Base64 开销）；读写时清理过期/最旧记录，不是定时备份。记录**未加密**，可能含敏感源码；保护账户与目录权限，清空不等于安全擦除，记录不保证永久存在。

## 测试与构建

```powershell
npm test
npm run pack
npm run dist
```

`npm test` 覆盖 Git 集成、平台环境、文件树、项目编辑、PTY、本地恢复与仓库监听，使用临时测试仓库；不要针对个人工作仓库做破坏性测试。

真实桌面 smoke 需要图形环境与额外可选工具 `playwright-core`（不是应用运行依赖）：

```powershell
npm install --no-save --package-lock=false playwright-core
npm run test:desktop
npm run test:terminal
# 先生成当前目录包，再验证它（不验证安装器/portable）
npm run pack
node test/packaged-smoke.cjs
```

桌面测试使用临时仓库，替换目录选择对话框，默认截图写入 `screenshots/`。更多回归入口、架构与 PR 要求见 [贡献指南](CONTRIBUTING.md)。以上是复现入口，不是本次已执行或云端通过的证明。

## 贡献与许可

欢迎 Issue、PR、文档改进和 **Linux/macOS 实机测试贡献**！请说明平台、架构、复现步骤及实际测试范围，保持最小改动并避免提交产物。参见 [CONTRIBUTING.md](CONTRIBUTING.md)（含 English 参与入口）。

采用 [MIT License](LICENSE)。
