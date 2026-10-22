# Branchcraft

面向 Windows 的 Git 可视化桌面应用，使用 Electron 与原生 JavaScript。直接调用本机 Git，非静态演示。

## 启动

便携版：双击 `release/Branchcraft 1.0.0.exe`。无需安装 Node.js，但必须安装 Git for Windows，并确保 `git --version` 可在终端执行。便携版仅表示无需安装应用，Electron 的用户设置仍会存放在系统用户目录。应用未配置发布者代码签名，Windows 可能显示安全提示；请只运行可信来源的程序。

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

`npm test` 在系统临时目录创建独立仓库，覆盖 12 项 Git 集成测试：首次提交与中文路径、暂存区 Diff、目录删除、重命名、分支、合并冲突、取消合并、Stash 完整流程、过期引用与 pop 冲突、本地远程同步、路径与并发防护、二进制与大文件。

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

未设置开源许可证；如需公开发布，请自行确定适合的许可证并补齐品牌图标与代码签名。
