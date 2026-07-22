# Node Forge

一个可部署到 GitHub Pages 的纯前端 sing-box 客户端配置生成器。页面不会上传文件，所有解析和生成都发生在浏览器中；输入内容不会写入浏览器存储，刷新即清除。

## 使用方式

1. 打开页面后直接粘贴 inventory 与完整 sing-box 客户端模板。输入停止约 400ms 后会自动解析、校验并更新预览。
2. 在 Ansible 的主机定义中为每一个节点增加唯一的 `singbox_name`：

   ```ini
   [lxc_nodes]
   1.1.1.1 ansible_port=22 deployment_env=example-a singbox_name=example-a
   2.2.2.2 ansible_port=22 deployment_env=example-b singbox_name=example-b
   ```

2. 确保节点 IP 同时存在于 `[singbox_nodes]`：

   ```ini
   [singbox_nodes]
   1.1.1.1
   2.2.2.2
   ```

3. 在“协议样板”中勾选要批量复制的 outbound。别名根据 outbound 的协议类型默认生成：Shadowsocks 为 `ss`、Hysteria2 为 `hy2`、AnyTLS 为 `anytls`；同类型的第二个样板会自动使用 `ss-2`、`hy2-2`。也可以手动修改别名。样板卡片中的“生成端口”可覆盖模板端口，范围为 `1-65535`。点击样板名称会定位到上方 JSON 中的原始 outbound。
4. 勾选需要更新的 selector。有效配置会实时显示完整生成 JSON，可直接下载 `config.json`。

若节点 `singbox_name=rear`，选中别名为 `ss` 与 `hy2` 的样板，会生成 `rear-ss` 和 `rear-hy2`。每个新 outbound 保留样板的端口、密码、TLS SNI 和其他协议参数，仅替换 `tag` 与 `server`。

## 注意

- 不要把真实的 `inventory.ini`、客户端模板或导出的 `config.json` 提交到公开的 GitHub Pages 仓库。项目的 `.gitignore` 已默认忽略常用文件名，但提交前仍应检查变更内容。
- 此版本只解析简单的 INI 主机定义。`singbox_name` 应使用字母、数字、`-` 或 `_`，并在所有 sing-box 节点中唯一。
- 模板中类型为 `shadowsocks`、`hysteria2`、`anytls`、`vless`、`trojan` 或 `tuic` 的 outbound 可以作为复制样板。
- 被选中的样板将从配置中移除并替换为新生成的全部节点。被选中 selector 会使用全部新节点；例如 `urltest` 的 `outbounds` 直接引用了已选样板时，也会替换为对应新节点，避免出现悬空 tag。未选中的 outbound、DNS、route、inbounds 和其他字段将保持不变。
