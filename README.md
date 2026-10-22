# Branchcraft

面向 Windows、Linux 与 macOS 的 Git 可视化桌面应用，使用 Electron 与原生 JavaScript。直接调用本机 Git，非静态演示。

## 启动

便携版：双击 `release/Branchcraft-1.0.0-win-x64-portable.exe`。无需安装 Node.js，但必须安装 Git for Windows，并确保 `git --version` 可在终端执行。便携版仅表示无需安装应用，Electron 的用户设置仍会存放在系统用户目录。应用未配置发布者代码签名，Windows 可能显示安全提示；请只运行可信来源的程序。

开发运行（PowerShell）：

```powershell
Set-Location D:\Learn\gittool
npm.cmd ci
npm.cmd start
```

开发环境已验证 Node.js 24、npm 11、Git 2.47。打开应用后点击“打开仓库”，选择已有 Git 仓库目录。应用不会替你初始化目录或设置全局 Git 用户信息。

## 功能与使用

- **工作区**：查看已暂存、未暂存、未跟踪文件及文本 Diff；支持单文件与全部暂存/取消暂存。填写提交说明后提交已暂存内容。
- **提交历史**：显示最近 180 条历史、父提交关系图、分支标签、提交元数据和补丁。当前图形布局适合常规分支数量，复杂多并行分支可能发生视觉重叠。
- **分支**：新建并切换本地分支、切换已有本地分支；远程分支通过显式跟踪创建本地分支；可合并分支。
- **远程**：Fetch 拉取远程引用；Pull 使用 `--ff-only`，遇到分叉会拒绝而非隐式合并；Push 使用 Git 配置的默认远程/上游。首次推送新分支时，可能需要先在终端设置上游。
- **Stash**：查看列表和补丁；保存当前修改时可填写说明、选择包含未跟踪文件，默认包含未跟踪文件，但不包含忽略文件。应用会将成功储藏的修改移出工作区。
  - “应用”保留储藏；“恢复并移除”仅在应用成功后移除；冲突时 Git 保留储藏。
  - “删除”需确认，可能永久丢失未提交修改；操作会检查所选储藏是否已被其他操作改变。
  - Stash 补丁包含未跟踪内容。不承诺恢复原先暂存区状态（没有使用 `--index`）。
- **冲突**：查看文本冲突基线、当前分支与传入内容，编辑解决结果后保存并暂存；清理冲突标记后完成提交。支持中止合并。

## 使用边界与安全提示

应用会真实修改所选仓库。重要修改请先备份或提交；执行合并、Stash 恢复和删除前检查当前分支。大量操作时不要同时用其他 Git 客户端修改同一仓库。

Git 用户姓名、邮箱、远程 URL、SSH 密钥和凭据管理器均沿用本机 Git 配置，没有内置账户登录或凭据管理页面；终端交互式密码提示已禁用，网络认证可能需要先在终端配置。远程集成测试使用本地 bare 仓库，不代表已验证第三方服务的网络/认证流程。

内置冲突编辑器适用于普通文本文件；二进制、大于 2MB 的文本冲突、删除/修改冲突及特殊重命名冲突请使用外部工具，完成后回到应用刷新。未跟踪文件预览有 2MB 限制；Git 输出缓存上限 24MB，单次 Git 命令超时 120 秒。没有逐行暂存、交互式 rebase、仓库克隆或强制推送功能。Git 的内容相似度识别决定重命名是否显示为整体：变化较大时可能显示为独立删除与新增，需要分别处理。

## 测试与构建

```powershell
npm.cmd test
npm.cmd run pack
npm.cmd run dist
```

`npm test` 在系统临时目录创建独立仓库，覆盖 Git 集成、平台环境、文件树、项目编辑、PTY、本地恢复与仓库监听测试：首次提交与中文路径、暂存区 Diff、目录删除、重命名、分支、合并冲突、取消合并、Stash 完整流程、过期引用与 pop 冲突、本地远程同步、路径与并发防护、二进制与大文件。

桌面烟雾测试（可选开发工具）：

```powershell
npm.cmd install --no-save --package-lock=false playwright-core
node test/desktop-smoke.cjs
```

脚本启动真实 Electron 窗口，通过按钮和 IPC 验证打开仓库、Diff、暂存、提交、历史和 Stash 预览；仅替换系统目录选择对话框，使用临时测试仓库并清理。截图保存在 `screenshots/`，可用 `BRANCHCRAFT_OUTPUT` 环境变量修改。可设置 `BRANCHCRAFT_EXE` 为 `release/win-unpacked/Branchcraft.exe` 验证打包版本。

## 代码结构

- `main.js`：窗口生命周期、仓库选择、IPC 路由。
- `preload.js`：受限的 Git API 桥接。
- `git-service.js`：参数化 Git 调用、状态解析、Diff、分支、Stash 与冲突处理。
- `renderer.js`：视图状态、交互、提交图和 Diff 渲染。
- `index.html` / `styles.css`：桌面布局与样式。
- `test/git-service.test.js`：后端集成测试。
- `test/desktop-smoke.cjs`：真实桌面烟雾测试。
- `test/packaged-smoke.cjs`：按本机系统与架构定位打包目录，复用界面回归。
- `platform.js`：Git 可执行文件配置及 GUI 启动环境适配。
- `.github/workflows/build.yml`：四组原生系统/架构的构建与验证配置。

package.json 的许可证元数据标注为 MIT，但当前未附完整 LICENSE 文本；公开发布前请确认授权并补齐许可证文件、品牌图标与代码签名。主页 https://branchcraft.example.invalid 及 Linux 包中的维护者邮箱为 example.invalid 占位值，正式发布前请替换为有效维护信息。

## 三平台构建与运行

| 系统 | 架构 | 产物 | 系统要求与注意事项 |
|---|---|---|---|
| Windows | x64 | NSIS 安装程序、portable EXE | Windows 10/11；预装 Git for Windows |
| Linux | x64 | AppImage、deb | 建议 Ubuntu 22.04+ 桌面；预装 Git、GTK3/NSS/GBM 等运行库 |
| macOS | Intel x64、Apple Silicon arm64 | DMG、ZIP | 建议 macOS 12+；预装 Git；选择匹配 CPU 的安装包 |

源码开发需要 Node.js 24 与 npm。各系统在项目根目录执行 `npm ci`、`npm start`。`npm run pack` 打包当前系统目录，`npm run dist` 生成当前平台发行文件；显式命令为 `npm run dist:win`、`npm run dist:linux`、`npm run dist:mac`。macOS 发行构建请在 macOS 上运行；不要尝试通过普通 Linux Docker 容器构建/验证原生 macOS 应用。

macOS 关闭最后一个窗口后保留应用，通过 Dock 可重新打开；提供原生编辑菜单，支持 Cmd+C/V/Z 等快捷键。GUI 启动时补充 Homebrew 和系统 Git 常用路径，不读取或执行 shell 配置。自定义 Git 路径可通过启动应用前设置 `BRANCHCRAFT_GIT`（绝对路径，不能附加命令参数）。SSH agent 和原有环境变量保留；GUI 不一定继承终端的自定义 SSH 环境。

Linux AppImage 可能需要 `chmod +x 文件.AppImage` 和 FUSE（Ubuntu 22.04 可安装 `libfuse2`）；也可使用 deb 安装。不要以 root 身份运行桌面程序，不建议通过 `--no-sandbox` 规避权限问题。用户数据通过 Electron 的系统目录保存：Windows `%APPDATA%/Branchcraft`、macOS `~/Library/Application Support/Branchcraft`、Linux `$XDG_CONFIG_HOME/Branchcraft` 或 `~/.config/Branchcraft`，以实际 Electron userData 路径为准。

### GitHub Actions

`.github/workflows/build.yml` 在 main/master 推送、PR、v 开头标签及手动触发时执行：Windows x64、Ubuntu x64、macOS Intel 和 Apple Silicon 原生 runner 分别安装依赖、运行后端测试和真实 Electron 源码桌面烟雾测试，再打包对应平台。Linux 使用 Xvfb；每个任务还会启动打包目录中的可执行程序进行桌面回归，再上传安装包和测试截图到该次运行的 Artifacts。需将源码（含 package-lock.json 与 .github）推送至你有权限的 GitHub 仓库并启用 Actions；本地生成配置不代表云端任务已执行。工作流不会自动发布 Release，也不需要签名密钥。

当前发行包未配置 Windows 签名或 Apple 签名/公证。macOS 可能被 Gatekeeper 拦截，请仅对可信来源按系统设置允许；正式公开发行需配置 Developer ID、签名及公证。默认图标仍为 Electron 图标。平台配置与 CI 并不等同于对应平台已经通过实测，具体以随附验证记录及实际 Actions 日志为准。

### Docker 中的 Linux 验证

在 Docker Linux 引擎执行 `docker build -f Dockerfile.validation -t branchcraft-validation .`，然后执行 `docker run --name branchcraft-validation branchcraft-validation`。容器自动运行 14 项测试、Xvfb Electron 桌面烟雾测试并生成 Linux AppImage/deb，随后启动 linux-unpacked 中的程序进行界面回归。镜像显式安装 xz-utils 和 binutils，分别提供 deb 打包所需的 xz 与 ar。可用 `docker cp branchcraft-validation:/app/release ./linux-release` 提取产物，再自行删除测试容器。

容器专用测试开关 `BRANCHCRAFT_TEST_NO_SANDBOX=1` 仅给测试启动器传递 `--no-sandbox`，用于 Docker 缺少用户命名空间权限的场景，不改变正式应用默认 sandbox 设置。容器结果不代表真实 Linux 桌面环境、Wayland、FUSE 启动、外部网络认证或 macOS 通过测试。普通 Linux 容器不能运行 macOS Cocoa 应用。

## Git 基线与开发分支

`main` 的首个提交 `e6ab251` 来自之前交付的 Windows 初版源码归档，标签为 `baseline/windows-v1.0.0`。跨平台改动从独立分支 `feature/cross-platform` 的 `1e06ce4` 开始保存；后续修复继续提交到该分支，不覆盖初版。源码 ZIP 不包含 .git；已有开发仓库保留完整历史。

本地未配置 Git 远程地址，未执行 GitHub Actions，也未生成或验证 macOS 安装包。可将仓库推送到有权限的 GitHub 仓库后，在 Actions 中手动运行“三平台测试与打包”；下载各架构 Artifacts，并核对每项任务与测试截图。

## 早期跨平台基线验证（不代表本轮新增功能验收）

- Windows x64：14/14 自动化测试通过；NSIS 与 portable 重新生成；win-unpacked 真实界面回归通过。未实际安装 NSIS；portable 的独立自动化启动此前超时，不能视为通过。构建日志中出现 signing 字样不代表可信签名，当前未配置签名证书。
- Docker Linux x64：14/14 自动化测试、源码界面、linux-unpacked 界面通过；AppImage 解压后的程序界面通过（不是 FUSE 挂载启动）；deb 生成、容器内安装及已安装程序界面通过。
- 界面回归覆盖启动、选择仓库、Diff、暂存、提交、历史和 Stash 详情，无页面异常。目录选择器由测试替换，测试使用独立临时仓库。
- 未实测真实 Linux 桌面、Wayland、AppImage FUSE 启动、macOS、远端认证与推送。Actions 配置未在云端运行。正式发布前需要独立验证、品牌图标、有效主页与维护者元数据、许可证确认及签名/公证。


## 增强工作流（feature/cross-platform）

工作区按文件夹折叠分组。未暂存文本修改可按文件或代码块回退；操作前确认，内容变化后拒绝使用旧预览，且不修改暂存区。工作区、历史与 Stash 点选条目保持列表滚动位置。

“项目文件”用于浏览 Git 已跟踪文件及未忽略的未跟踪文件。左侧编辑文本，右侧与 HEAD 或暂存区对比；Diff 可隐藏。Ctrl+S 保存到工作区，不自动暂存。切换文件或仓库前会提示未保存修改；检测到外部修改时拒绝覆盖。仅支持 2MB 内 UTF-8 文本，不跟随符号链接。

右上角“终端”展开**右侧**持续 PTY 面板：Windows 使用 PowerShell，Linux/macOS 使用登录 Shell。命令、环境变量、当前目录及交互进程在同一会话内保持；支持键盘输入、Ctrl+C 与尺寸调整。隐藏面板不结束 Shell，重新展开继续原会话；切换仓库、页面重载或关闭窗口会清理旧会话。Shell 退出后可重新打开。终端能执行真实系统命令，请像使用系统终端一样谨慎；它不是命令沙箱，也不会逐条确认危险命令。

### 原生依赖与构建

`npm ci` 的 postinstall 检查 node-pty 是否提供完整目标 N-API 预构建；存在时直接使用，否则运行 electron-builder 的原生依赖安装流程。`npm run pack` / `dist` 系列通过 `scripts/build.cjs` 保留生产依赖收集，仅对具有完整预构建的全部目标跳过强制重编译。Linux 仍走正常原生编译流程，可能需要 Python、make 和 C/C++ 编译器；不要为所有平台统一关闭原生编译。node-pty 的原生文件通过 asarUnpack 放在包外。

终端真实桌面回归（需额外开发工具 playwright-core，不是应用运行依赖）：

```powershell
npm.cmd install --no-save --package-lock=false playwright-core
npm.cmd run test:terminal
# 验证当前新生成的 Windows 目录包，而不是开发入口
$env:BRANCHCRAFT_EXE = "$PWD\release\win-unpacked\Branchcraft.exe"
npm.cmd run test:terminal
Remove-Item Env:BRANCHCRAFT_EXE
```

本轮在 Windows x64 验证开发版和新目录包的真实 PTY：多命令状态、隐藏后输出与会话保留、右侧布局、尺寸变化、键盘输入、Ctrl+C、退出重开、仓库隔离及 Shell 清理。Linux/macOS 的本轮终端未实机验证；早期平台包不包含这些新功能，不能代替本轮验证。目录包验证也不等于 NSIS 安装器或便携启动器已重新验证。


## 外部刷新、提交审阅与本地恢复（本轮更新）

- 外部编辑器、终端或其他 Git 客户端产生变化后自动刷新；返回窗口、F5 和刷新按钮共用刷新入口。工作区保留当前选择、搜索、文件夹折叠与滚动位置；同一文件的 Git 状态字符不变时仍重新读取 Diff。打开确认、审阅或恢复对话框时延后刷新，不覆盖正在编辑的文本。
- 导航统一为项目文件、工作区、提交历史与 Stash 储藏室。工作区按冲突、已暂存、未暂存分组，各组支持嵌套文件夹。
- 提交先显示集中审阅，列出将提交的文件、文本增删统计、Diff 和未暂存内容提示。说明草稿按仓库保存在本机；Git / hook 失败显示原始输出并保留草稿，成功提交后清除。审阅后暂存内容变化须重新审阅。
- 恢复未暂存文件或代码块前，自动备份该文件的完整原始字节；恢复历史备份前也会备份当前状态。恢复成功后删除所选旧记录、保留恢复前的新备份，正常情况下条目总数不增加，仍可再次恢复以撤销；恢复失败不消费原记录。若恢复已成功但旧记录清理失败，会明确警告并暂留两份记录。恢复仅影响工作区，不改暂存区。备份失败时拒绝破坏性操作。
- 通过“本地恢复记录”查看、预览、恢复或手动清空当前仓库记录。文件不存在的备份恢复后会删除当前对应工作区文件；预览最多显示512KiB，恢复使用完整字节。
- 所有仓库共享 **100MiB（104857600字节，含 JSON/Base64 开销）** 上限，记录保留7天。在读取、写入记录时清理过期记录，容量不足时从最旧记录开始清理，不是独立定时备份服务；编码后单条备份超过容量上限时拒绝操作。备份不承诺永久存在。
- 记录存储于 Electron `app.getPath('userData')` 下的 `recovery` 目录（具体位置以实际 userData 路径为准；自定义 `--user-data-dir` 时随之变化），不写入 Git 仓库。记录未加密，可能包含敏感源码，请保护系统账户与用户目录权限；清空记录不等同于磁盘安全擦除。此安全网不替代 Git 提交或独立备份，不覆盖所有 Git 操作（如 Stash 删除、合并中止）。

补充回归命令（需本机 Electron 与 playwright-core）：

```powershell
node test/workflow-smoke.cjs
node test/editor-smoke.cjs
node test/project-tree-smoke.cjs
node test/workspace-hunks-smoke.cjs
node test/scroll-smoke.cjs
node test/terminal-smoke.cjs
node test/packaged-smoke.cjs
```

本轮仅在 Windows x64 实机验证；Linux/macOS 构建配置仍保留，但不代表已完成本轮实机验收。`npm run pack` 更新 `release/win-unpacked` 目录包；旧 portable.exe 不会被该命令更新。
