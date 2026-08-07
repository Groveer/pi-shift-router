# 故障排查

## Judge 解析失败

- **推理模型 token 不够** —— DeepSeek Reasoner 等把推理放在 `reasoning_content`、JSON 放在 `content`。默认 `max_tokens: 4000`；极长 prompt 可能不足。`/router verbose` 看原始响应。
- **Provider 不支持 JSON mode** —— 部分自定义 OpenAI 兼容端点忽略 `response_format`。
- **API key 失效** —— 检查 pi-agent 的 `auth.json`。

## "Judge fetch failed for … : TypeError: Cannot read 'slice' of undefined"

v0.8.0 修复（commit `de6073a`+）。根因：`JSON.stringify(undefined)` 返回的是 `undefined`（不是字符串 `"undefined"`）。当 Judge 端点返回 200 但 body 没有 `choices[]`（如某些 Provider 的错误结构），verbose 日志会在 `content.slice(...)` 崩溃。修复方式：`jsonStr()` 包装器对 undefined 返回 `"undefined"`。

如果你在旧版本仍看到，重新安装：`pi remove pi-shift-router && pi install <path-to-this-repo>`（例如在仓库根目录跑 `pi install .`）。

## 向导“找不到模型”

模型列表来自 pi-agent 的 `models-store.json`。新增 provider 后重启 pi-agent 让其重新发现。

## 状态栏一直显示 ⛔

路由器被禁用：`/router on`。若 config 里 `enabled: true` 仍显示 ⛔，看 `/router status` 的 `Config:` 行确认读取的配置路径。

## "Model not found" 警告

配置的 model ID 在 Provider 中不存在。更新 ID 或重跑 `/router config`（向导只会列出真实存在的模型）。

## 总是被降级到 Fast

Judge 误分类（`/router verbose` 查看）或阈值太激进。调高：

```json
"routing": { "window": { "size": 5, "threshold": 0.8, "minConfidence": 0.5 } }
```
