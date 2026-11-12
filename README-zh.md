# Zotero to Joplin

<img src="assets/icon.svg" width="96" alt="Zotero to Joplin">

把 Zotero 条目、子笔记和 PDF 注释导出到 Joplin，生成的笔记保留可点击的 `zotero://` 链接。

[English](README.md)

## 功能

- 一个 Zotero 条目对应一个 Joplin 笔记。
- 导出条目元数据、可选摘要、子笔记和 PDF 注释。
- 支持高亮、下划线、文字、笔记、区域、绘图六种注释。
- PDF 注释按页分组，注释标签用粗体链接，不占 Joplin 大纲层级。
- Zotero 笔记自带的各级标题会统一降级到笔记标题之下，避免打乱整篇文档的大纲。
- 图片/绘图注释上传为 Joplin 资源。
- 笔记标题和注释标题直接链接回 Zotero。
- 重复导出更新同一个笔记，并保留托管区域外的手写内容。
- 导出位置支持“每次导出时选择”“使用默认笔记本”“跟随 Zotero 分类树”。
- 所有导出都放在 `Zotero/` 下，不会写入其他 Joplin 笔记本。

## 导出位置

**每次导出时选择**

点击导出后弹出选择窗口，只列出 `Zotero/` 下的笔记本。默认选中上次使用的目标；目标不存在时回退到 `Zotero` 根目录。

**使用默认位置**

- **设置默认笔记本**：所有条目导出到同一个笔记本。留空时使用 `Zotero` 根目录。
- **跟随 Zotero 分类树**：使用当前导出视图所在的分类。无法确定单一分类时（My Library、保存搜索、多选等），使用 `Zotero` 根目录。

分类改名或移动时，插件会更新对应的 Joplin 笔记本；分类删除后，条目下次导出回到 `Zotero` 根目录。插件不会自动删除 Joplin 笔记本。

## 环境要求

- Zotero 8–10（在 Zotero 10.0.8 上验证）。
- Joplin 桌面端，开启 Web Clipper（网页剪藏器）服务（在 Joplin 3.6.15 上验证）。导出时 Joplin 需要保持运行。
- 不需要其他 Zotero 插件或 Joplin 插件。

## 安装

1. 从 [Releases](../../releases) 下载最新的 `.xpi`。
2. Zotero：**工具 → 插件 → ⚙ → Install Add-on From File…**，选择 `.xpi`。
3. Joplin：**设置 → Web Clipper（网页剪藏器）**，启用服务并复制授权 token。
4. Zotero：**设置 → Zotero to Joplin**，粘贴 token，选择导出位置，点击 **测试 Joplin 连接**。

## 使用

1. 在 Zotero 中选中一个或多个条目。
2. 右键选择 **导出内容到 Joplin**。
3. 如果导出方式是“每次导出时选择”，先选择本次目标笔记本；取消则中止导出。
4. 再次导出会更新同一个笔记。

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
