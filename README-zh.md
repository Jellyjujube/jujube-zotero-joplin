# Zotero to Joplin

<img src="assets/icon.svg" width="96" alt="Zotero to Joplin">

把 Zotero 条目、子笔记和 PDF 注释导出到 Joplin，生成的笔记保留可点击的 `zotero://` 链接。

[English](README.md)

## 功能

- 一个 Zotero 条目对应一个 Joplin 笔记。
- 导出条目元数据、可选摘要、子笔记和 PDF 注释。
- 支持高亮、下划线、文字、笔记、区域、绘图六种注释。
- 图片/绘图注释上传为 Joplin 资源。
- 笔记标题和注释标题直接链接回 Zotero。
- 重复导出更新同一个笔记，并保留托管区域外的手写内容。
- 可选择已有 Joplin 笔记本或新建，支持 `Zotero/Papers` 这类多级路径。

## 环境要求

- Zotero 8–10（在 Zotero 10.0.8 上验证）。
- Joplin 桌面端，开启 Web Clipper 服务（在 Joplin 3.6.15 上验证）。导出时 Joplin 需要保持运行。
- 不需要其他 Zotero 插件或 Joplin 插件。

## 安装

1. 从 [Releases](../../releases) 下载最新的 `.xpi`。
2. Zotero：**工具 → 插件 → ⚙ → Install Add-on From File…**，选择 `.xpi`。
3. Joplin：**设置 → Web Clipper**，启用服务并复制授权 token。
4. Zotero：**设置 → Zotero to Joplin**，粘贴 token，选择笔记本，点击 **测试 Joplin 连接**。

## 使用

1. 在 Zotero 中选中一个或多个条目。
2. 右键选择 **导出内容到 Joplin**。
3. 再次导出会更新同一个笔记。

## 构建

```bash
npm install
npm run build
# .scaffold/build/zotero-to-joplin.xpi
```

单元测试：

```bash
npm run test:unit
```

## 许可证

AGPL-3.0-or-later
