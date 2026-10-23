# 贡献指南 / Contributing

欢迎 Issue、PR、文档改进与平台测试贡献！见 [中文 README](README.md) / [English README](README.en.md)。本指南默认中文，末尾提供 English 参与入口。

## 开发准备

需要 Node.js 24、npm 11 和系统 Git；Windows 使用 Git for Windows。原生依赖缺少目标预构建时需要编译工具链，Linux 需 Python、make、C/C++ 编译器。

```powershell
git clone --branch main https://github.com/MannixYang/Branchcraft.git
cd Branchcraft
npm ci
npm start
```

PowerShell 若拦截 `npm.ps1`，请改用 `npm.cmd`。外部贡献者可先 fork，再从 `main` 创建小型主题分支，通过 PR 提交。

开发主线为 `main`；请基于该分支创建主题分支。

## 架构与职责

| 文件 | 职责 |
| --- | --- |
| `src/main/index.js` | Electron 生命周期、窗口、仓库选择、服务装配与 IPC 路由 |
| `src/preload/index.js` | 向渲染进程暴露受限 API 与事件订阅 |
| `src/main/git-service.js` | 参数化 Git 调用、状态/Diff、提交审阅、分支、Stash、冲突、块操作与恢复入口 |
| `src/main/platform.js` | Git 可执行文件选择与 GUI 环境 PATH 适配 |
| `src/renderer/renderer.js` | 工作区/历史/Stash 界面状态、提交图、Diff 和交互 |
| `src/main/project-service.js` / `src/renderer/project-ui.js` | 项目文件安全读写、版本 token、比较与编辑界面 |
| `src/shared/file-tree.js` | 浏览器与 Node 测试共用的 UMD 文件树纯逻辑 |
| `src/main/terminal-service.js` / `src/renderer/terminal-ui.js` | 持续 PTY 生命周期、输入/输出/尺寸与终端面板 |
| `src/main/recovery-store.js` | 本地恢复记录、容量/期限与安全路径检查 |
| `src/main/repo-watcher.js` | 仓库变化检测与刷新通知 |
| `src/renderer/index.html` / `src/renderer/styles.css` | 布局与样式 |
| `scripts/install-native.cjs` / `scripts/native-policy.cjs` / `scripts/build.cjs` | 原生依赖安装、完整目标预构建判断、统一打包入口 |
| `test/` | Node 测试与真实 Electron smoke 脚本 |
| `.github/workflows/build.yml` / `Dockerfile.validation` | 自动化构建/验证配置；配置存在不代表已运行或通过 |

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

## 变更原则

- 保持最小、单一目的的变更；遵循原生 JavaScript 风格，不为小修复引入无关重构或新依赖。
- Git 服务、IPC 桥接与界面职责分离；使用参数化命令和仓库相对路径校验，不拼接不可信 Shell 命令。
- 保留 token 过期拒绝、路径/符号链接防护、备份失败拒绝等边界；补充成功路径和失败/并发/越界测试。
- 涉及用户行为、命令、限制或平台时同步两份 README 的核心内容。
- 不提交 `node_modules/`、`release/`、`screenshots/`、日志或包含本地路径/敏感源码/凭据的临时文件。

## 测试与 smoke 命令

```powershell
npm test
```

该命令运行 `git-service`、`platform`、`file-tree`、`project-service`、`terminal-service`、`recovery-store`、`repo-watcher` 的 Node 测试。使用临时目录中的独立仓库；远程集成使用本地 bare 仓库，不等同于托管平台认证测试。

桌面 smoke 需要真实图形环境、Electron 与额外可选开发工具 `playwright-core`；它不是应用运行依赖：

```powershell
npm install --no-save --package-lock=false playwright-core
npm run test:desktop
npm run test:terminal
node test/workflow-smoke.cjs
node test/editor-smoke.cjs
node test/project-tree-smoke.cjs
node test/workspace-hunks-smoke.cjs
node test/scroll-smoke.cjs
```

桌面脚本使用临时仓库，部分脚本替换目录选择器；生成截图的脚本默认输出至 `screenshots/`，支持时可用 `BRANCHCRAFT_OUTPUT` 修改。`test:terminal` 当前发送 PowerShell 语法，不能直接作为 Linux/macOS Shell 验收脚本；跨平台贡献需补相应断言。Linux 无显示环境可按配置使用 Xvfb，但不能替代真实桌面验收。

验证目录包（不是安装器或 portable 启动器）：

```powershell
npm run pack
node test/packaged-smoke.cjs
```

PowerShell 可为支持该变量的 smoke 脚本指定当前 Windows 目录包：

```powershell
$env:BRANCHCRAFT_EXE = Join-Path $PWD 'release/win-unpacked/Branchcraft.exe'
npm run test:terminal
Remove-Item Env:BRANCHCRAFT_EXE
```

`npm run pack` 只刷新目录包，不更新旧 portable/安装器。发行文件用 `npm run dist` 或 `npm run dist:win` / `npm run dist:linux` / `npm run dist:mac`，均通过 `scripts/build.cjs`。macOS 应在 macOS 构建；Linux 原生编译不能一概跳过。

**禁止用个人仓库测试破坏性操作**：合并/中止、回退、Stash 删除与恢复、推送等请使用可丢弃临时仓库和本地 bare 远程。不要接触真实凭据或重要源码；内置 PTY 是真实 Shell，不是沙箱。

## v1.0.0 预发布流程

开发主线为 `main`。以下描述自动发布规则；实际构建与发布状态请查看 GitHub Actions 和 Releases，不应将配置存在视为验证通过。

推送与 `package.json` 版本一致的 `v1.0.0` 标签后，`.github/workflows/build.yml` 要求 Windows x64、Linux x64、macOS x64、macOS arm64 四个平台的单元测试、源码桌面测试、打包及打包版桌面测试全部通过，才自动发布 GitHub **Pre-release**，设置 `make_latest: false`（不设 Latest）。分支构建本身不发布。

附件为 **8 个发行包 + `SHA256SUMS.txt`**：Windows 安装器/portable EXE、Linux AppImage/deb、macOS x64 DMG/ZIP、macOS arm64 DMG/ZIP。流程先建草稿、上传全部附件，再公开预发布；请核对校验和。当前包未签名，macOS 未经 Apple 公证，系统可能提示风险；先在测试仓库体验。目录包 smoke 不等同于安装器或 portable 启动器验收。

## Issue 与 PR

- Issue：描述预期/实际行为、最小复现、系统与架构、Node/npm/Git 版本；日志需脱敏。
- PR：说明目的、主要改动、关联 Issue、执行的测试命令与结果；未执行的检查明确写“未验证”并说明原因。
- UI 变更可附必要截图，但不要把生成截图目录加入源码提交。
- 分别报告源码、目录包、portable 与安装器的验证范围，不能用 `pack` 成功代替安装测试或功能验收，不能把本地配置称作云端 CI 已通过。
- 当前使用/验证平台为 Windows x64；**Linux/macOS 本轮实机验证尚未完成**。欢迎贡献桌面、终端、打包、安装和 Git 认证测试，注明系统版本/发行版、CPU 架构、桌面环境及实际产物。
- 贡献按项目 [MIT License](LICENSE) 提供；不要加入无权分发的内容。

## English participation

Issues and PRs are welcome. Start with the [English README](README.en.md), use Node.js 24, npm 11 and system Git, then create a focused topic branch from `main` (fork first if needed).

- The development mainline is `main`; create focused topic branches from it.
- Put main services in `src/main/`, restricted bridging in `src/preload/`, UI/HTML/CSS in `src/renderer/`, and browser/Node-compatible UMD pure logic in `src/shared/`. Keep scripts/tests/workflows in their existing directories; see the [source layout](README.en.md#source-layout-and-resource-placement) for relative paths and resource rules.
- Keep changes small and preserve service/UI boundaries, path checks, stale-token rejection and recovery safeguards. Update both READMEs for user-facing changes.
- A matching `v1.0.0` tag publishes a non-Latest Pre-release only after all four platform/architecture jobs pass; expect 8 packages plus `SHA256SUMS.txt`. This is policy, not evidence of completed tests or a release.
- Run `npm test`; desktop checks optionally need `playwright-core`, installed with `npm install --no-save --package-lock=false playwright-core`. Use `npm run test:desktop`, `npm run test:terminal` and the relevant focused scripts above.
- Run `npm run pack` before `node test/packaged-smoke.cjs`. This tests the unpacked app, not a portable launcher or installer; `pack` does not refresh those artifacts.
- Use disposable temporary repositories/local bare remotes, never personal repositories for destructive tests. The PTY is a real shell, not a sandbox.
- Do not commit dependencies, release artifacts, screenshots, logs or secrets. Report platform/architecture, exact commands/results and anything not tested in your PR.
- The terminal smoke currently sends PowerShell syntax; adapt its assertions before using it to validate Linux/macOS shells. Screenshot output defaults to `screenshots/` where supported; some scripts support `BRANCHCRAFT_OUTPUT`.
- Windows x64 is the current usage/validation platform; Linux/macOS lack real-machine validation this round. Testing contributions are especially welcome. Configuration is not evidence of passing cloud CI or installers.
- Contributions are provided under the project's [MIT License](LICENSE).
