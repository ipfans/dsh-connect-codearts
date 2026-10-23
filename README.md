# @ipfans/dsh-connect-codearts

将华为云 CodeArts 订阅模型接入 DeepSeek Harness。原生 TypeScript 插件，直接签名调用 CodeArts 接口，使用 DSH 的会话、工具执行和权限体系。

**0.1.1**：移除华为已关闭的免费福利模型、额度查询和签到功能；同一账号复用稳定的上游会话标识，避免连续请求触发三会话上限。

## 兼容版本

- DeepSeek Harness：**0.2.1-rc.2**。
- `@earendil-works/pi-ai`：固定 **1.1.0**。
- Node.js：`^22.19.0 || >=24.0.0`。
- 支持具备本地宿主服务的 DSH Web / Desktop 设置页；控制接口仅接受本机回环来源。

## 安装

在 DSH 的 **设置 → 插件 → 添加插件** 中填写：

```text
@ipfans/dsh-connect-codearts
```

也可以使用已安装的 DSH CLI：

```sh
dsh plugin --profile desktop add @ipfans/dsh-connect-codearts
```

Web profile 将 `desktop` 改为 `web`。安装后重启 DSH。也可使用 `github:ipfans/dsh-connect-codearts` 安装；仓库包含预构建的 `lib/`，无需本地编译。

## 使用

1. 打开 **设置 → CodeArts**，添加账号名称、Access Key（AK）与 Secret Key（SK）。AK/SK 可在[华为云访问密钥页面](https://console.huaweicloud.com/iam/#/mine/accessKey)创建。
2. 首个账号默认选中；添加更多账号后，可手动选择当前账号。编辑时 AK/SK 留空可保留原值。
3. 点击 **刷新模型**，在对话模型选择器中选择 CodeArts 模型。

账号切换影响后续请求，进行中的请求继续使用原账号。删除当前账号会清空选择。若新账号没有会话原先使用的模型，需要重新选择一个可用模型。

## 功能与行为

- 从 AgentCenter 发现当前账号可用的订阅模型。
- 模型标识保持 `agent/<模型ID>`，请求上游时还原真实 ID，兼容已有订阅模型会话。
- 支持正文流、推理内容、工具调用参数分片、工具结果回传及 token 用量。图片仅在上游明确声明支持时启用。
- 模型上下文和输出上限来自当前账号的上游元数据；缺少关键字段的模型会跳过，并在设置页说明原因。
- 模型目录按账号和凭据版本缓存五分钟；手动刷新绕过缓存。重启后重新发现。
- 刷新失败保留本账号先前成功的模型目录。异常断流和 HTTP 200 业务错误均报告失败。
- 同一 AK 的请求复用上游会话标识，不随 DSH 会话或请求变化；华为会话上限错误按限流处理。
- 套餐没有可靠的按 token 价格，DSH 价格字段为零；实际使用仍按华为套餐或积分计费。
- 无自动账号轮换、独立 OpenAI 服务或推理档位探测。

## 凭据与请求

AK/SK 使用 DSH 自带的 `ctx.credentials` 持久保存，记录键为 `dsh-connect-codearts/accounts`。沿用宿主凭据存储的文件保护和原子写入；插件不另建密钥文件，不将密钥写入普通配置。设置页仅返回 AK 末四位，保存后清空浏览器输入框。

请求使用 [Huawei Cloud SDK-HMAC-SHA256](https://support.huaweicloud.com/devg-apisign/api-sign-algorithm-001.html) 签名，并发送 DSH 的应用归属信息。仅访问固定的 `snap-access.cn-north-4.myhuaweicloud.com` 聊天与 AgentCenter 接口，拒绝重定向。

AK/SK 的权限由华为云账号配置决定，请勿把真实密钥写入源码或提交到 Git。上游接口信息来自社区项目，账号权限、模型列表、限流与接口可用性仍由上游决定。

## 开发与验证

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:engine
```

宿主和客户端分别构建为 ESM 与 DSH 浏览器模块；后者的模块 ID 从包名派生。宿主 DSH 模块和 React 由 DSH 提供。

测试覆盖签名向量、模型目录、账号持久化与隔离、上游会话复用、工具调用往返、流式错误、取消、控制接口和设置页交互。引擎检查在离线 Cordis/DSH 环境加载构建产物，确认 provider、设置目录、控制路由和浏览器模块身份。

2026-10-23 使用真实账号验证：AgentCenter 模型发现正常；`GLM-5.2`、`glm-5.2-sft-harmony`、`openpangu-2.0-pro`、`openpangu-2.0-flash`、`glm-5.3`、`deepseek-v4.1-flash` 的流式对话与推理内容通过，`GLM-5.2` 工具调用及结果回传通过。`kimi-k3` 当时返回上游 TPM 限流，已按 429 处理。DSH Desktop 完整界面交互尚未验收。

## npm 发布

推送与 `package.json` 版本一致的 `v*` 标签会触发 [publish.yml](.github/workflows/publish.yml)：安装锁定依赖、构建、类型检查、测试、引擎加载检查，然后通过 GitHub Actions OIDC 发布公开 npm 包和 provenance，无需 `NPM_TOKEN`。

npm Trusted Publisher 配置为 GitHub 用户 `ipfans`、仓库 `dsh-connect-codearts`、工作流文件 `publish.yml`，不设置 Environment，并允许 `npm publish`。首次配置前必须在 npm 建立包记录；见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

## 参考与许可

- [dsh-workbuddy-connect-functy](https://github.com/functy23/dsh-workbuddy-connect-functy/tree/a13f54e34d357024801ea36963d1ba5c87923ca1)：provider 组装、插件打包和设置接入。
- [codearts2api](https://github.com/Johnsheng1/codearts2api/tree/d813ca0456f23cd73bb3bbee16627bc2a40036f9)：CodeArts 接口、签名与通道信息。
- [CodeArts2API 上游协议记录](https://github.com/2951461586/CodeArts2API/blob/main/docs/UPSTREAM.md)：福利通道关闭与上游会话上限的协议校对。

MIT。来源与署名见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。
