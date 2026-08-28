# sviber

[English](README.md)

sviber 是面向 [Sunniesnow](https://sunniesnow.github.io/game-unstable) 的浏览器与 NW.js 谱面编辑器。

[帮助手册](docs/index.html)是用户指南的唯一权威来源，其中包含当前 JavaScript/Ruby 宏 API 和快捷键。本 README 仅说明安装、开发、贡献和许可证。

## 安装发行版

从 [GitHub Releases](https://github.com/Desom-fu/sviber/releases) 下载适合当前平台和架构的压缩包，完整解压后运行其中的 sviber 可执行文件。请把可执行文件与同目录的全部运行库文件保留在一起。

发行构建按架构分别打包：Windows 提供 x86、x86_64 和 aarch64 ZIP，macOS 提供 x86_64 和 aarch64 DMG 镜像，Linux 提供 x86_64 和 aarch64 的 `tar.gz`；另外还提供可交给现有 NW.js 运行时打开的 `.nw` 包。

## 在浏览器中从源码运行

需要当前版本的 Node.js、npm 和现代浏览器。网页版本一次只编辑一张独立谱面；工程文件夹仅由 NW.js 桌面版支持。

```powershell
git clone https://github.com/Desom-fu/sviber.git
cd sviber
npm ci
npm start
```

打开 <http://127.0.0.1:4173/sviber/>。不要直接打开 `index.html`，因为 JavaScript 模块、依赖加载和 Service Worker 都需要 HTTP 来源。首次访问需要联网缓存依赖和字体，之后可以离线运行。

## 构建桌面版

```powershell
cd sviber
npm ci
npm run build
```

首次构建需要联网下载 NW.js 和固定版本的字体资源。Windows 下运行 `build/nw/sviber.exe`。分发时必须保留完整的 `build/nw` 目录，不要删除 `build/nw/package.nw/sviber/node_modules`，也不要删除可执行文件旁的运行库文件。生成的构建产物和图标已被 Git 忽略。

## 使用 Nix 安装

在启用 flakes 的 x86_64 或 aarch64 Linux 上运行：

```sh
nix build
./result/bin/sviber
```

flake 使用 `nixos-unstable`；也可以通过 `callPackage` 单独使用 `default.nix`。

## 开发与验收

```powershell
npm test
npm run verify:browser
npm run build
```

`npm run verify:browser` 会自行启动本地服务器并运行端到端浏览器回归。构建包包含程序许可证和打包字体的许可证。

## 贡献

提交 Pull Request 前请运行 `npm ci` 和 `npm test`。用户可见修改必须添加针对性回归测试并同步更新帮助手册；较大的设计改动请先在 [issue tracker](https://github.com/Desom-fu/sviber/issues) 中讨论。

## 许可证

sviber 使用 [AGPL-3.0-or-later](LICENSE) 许可证。打包字体和第三方依赖仍遵循各自许可证，桌面构建会包含相应字体许可证文件。
