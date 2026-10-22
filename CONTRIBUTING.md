# 贡献指南 / Contributing

欢迎 Issue、PR、文档改进与平台测试贡献！见 [中文 README](README.md) / [English README](README.en.md)。本指南默认中文，末尾提供 English 参与入口。

## 开发准备

需要 Node.js 24、npm 11 和系统 Git；Windows 使用 Git for Windows。原生依赖缺少目标预构建时需要编译工具链，Linux 需 Python、make、C/C++ 编译器。

```powershell
git clone --branch feature/cross-platform https://github.com/MannixYang/Branchcraft.git
cd Branchcraft
npm ci
npm start
```

PowerShell 若拦截 `npm.ps1`，请改用 `npm.cmd`。外部贡献者可先 fork，再从 `feature/cross-platform` 创建小型主题分支，通过 PR 提交。

## 架构与职责

| 文件 | 职责 |
| --- | --- |
| `main.js` | Electron 生命周期、窗口、仓库选择、服务装配与 IPC 路由 |
| `preload.js` | 向渲染进程暴露受限 API 与事件订阅 |
| `git-service.js` | 参数化 Git 调用、状态/Diff、提交审阅、分支、Stash、冲突、块操作与恢复入口 |
| `platform.js` | Git 可执行文件选择与 GUI 环境 PATH 适配 |
| `renderer.js` | 工作区/历史/Stash 界面状态、提交图、Diff 和交互 |
| `project-service.js` / `project-ui.js` | 项目文件安全读写、版本 token、比较与编辑界面 |
| `file-tree.js` | 文件树组织与相关纯逻辑 |
| `terminal-service.js` / `terminal-ui.js` | 持续 PTY 生命周期、输入/输出/尺寸与终端面板 |
| `recovery-store.js` | 本地恢复记录、容量/期限与安全路径检查 |
| `repo-watcher.js` | 仓库变化检测与刷新通知 |
| `index.html` / `styles.css` | 布局与样式 |
| `scripts/install-native.cjs` / `native-policy.cjs` / `build.cjs` | 原生依赖安装、完整目标预构建判断、统一打包入口 |
| `test/` | Node 测试与真实 Electron smoke 脚本 |
| `.github/workflows/build.yml` / `Dockerfile.validation` | 自动化构建/验证配置；配置存在不代表已运行或通过 |

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

## Issue 与 PR

- Issue：描述预期/实际行为、最小复现、系统与架构、Node/npm/Git 版本；日志需脱敏。
- PR：说明目的、主要改动、关联 Issue、执行的测试命令与结果；未执行的检查明确写“未验证”并说明原因。
- UI 变更可附必要截图，但不要把生成截图目录加入源码提交。
- 分别报告源码、目录包、portable 与安装器的验证范围，不能用 `pack` 成功代替安装测试或功能验收，不能把本地配置称作云端 CI 已通过。
- 当前使用/验证平台为 Windows x64；**Linux/macOS 本轮实机验证尚未完成**。欢迎贡献桌面、终端、打包、安装和 Git 认证测试，注明系统版本/发行版、CPU 架构、桌面环境及实际产物。
- 贡献按项目 [MIT License](LICENSE) 提供；不要加入无权分发的内容。

## English participation

Issues and PRs are welcome. Start with the [English README](README.en.md), use Node.js 24, npm 11 and system Git, then create a focused topic branch from `feature/cross-platform` (fork first if needed).

- Keep changes small and preserve service/UI boundaries, path checks, stale-token rejection and recovery safeguards. Update both READMEs for user-facing changes.
- Run `npm test`; desktop checks optionally need `playwright-core`, installed with `npm install --no-save --package-lock=false playwright-core`. Use `npm run test:desktop`, `npm run test:terminal` and the relevant focused scripts above.
- Run `npm run pack` before `node test/packaged-smoke.cjs`. This tests the unpacked app, not a portable launcher or installer; `pack` does not refresh those artifacts.
- Use disposable temporary repositories/local bare remotes, never personal repositories for destructive tests. The PTY is a real shell, not a sandbox.
- Do not commit dependencies, release artifacts, screenshots, logs or secrets. Report platform/architecture, exact commands/results and anything not tested in your PR.
- The terminal smoke currently sends PowerShell syntax; adapt its assertions before using it to validate Linux/macOS shells. Screenshot output defaults to `screenshots/` where supported; some scripts support `BRANCHCRAFT_OUTPUT`.
- Windows x64 is the current usage/validation platform; Linux/macOS lack real-machine validation this round. Testing contributions are especially welcome. Configuration is not evidence of passing cloud CI or installers.
- Contributions are provided under the project's [MIT License](LICENSE).
