# dsh-connect-codearts

将华为云 CodeArts 订阅模型与免费额度模型接入 DeepSeek Harness。原生 TypeScript 插件，直接签名调用 CodeArts 接口，使用 DSH 的会话、工具执行和权限体系。

## 兼容版本

- DeepSeek Harness：**0.2.1-rc.2**。
- `@earendil-works/pi-ai`：固定 **1.1.0**。
- Node.js：`^22.19.0 || >=24.0.0`。
- 支持具备本地宿主服务的 DSH Web / Desktop 设置页；控制接口仅接受本机回环来源。

## 安装

在 DSH 的 **设置 → 插件 → 添加插件** 中填写：

```text
github:ipfans/dsh-connect-codearts
```

也可以使用已安装的 DSH CLI：

```sh
dsh plugin --profile desktop add github:ipfans/dsh-connect-codearts
```

Web profile 将 `desktop` 改为 `web`。安装后重启 DSH。仓库包含预构建的 `lib/`，GitHub 安装无需本地编译。

## 使用

1. 打开 **设置 → CodeArts**，添加账号名称、Access Key（AK）与 Secret Key（SK）。AK/SK 可在[华为云访问密钥页面](https://console.huaweicloud.com/iam/#/mine/accessKey)创建。
2. 首个账号默认选中；添加更多账号后，可手动选择当前账号。编辑时 AK/SK 留空可保留原值。
3. 点击 **刷新模型与额度**，在对话模型选择器中选择 CodeArts 模型。
4. 免费模型需要对应的免费额度，可点击 **领取每日免费额度**，随后余额会刷新。

账号切换影响后续请求，进行中的请求继续使用原账号。删除当前账号会清空选择。若新账号没有会话原先使用的模型，需要重新选择一个可用模型。

## 功能与行为

- 订阅与免费模型目录独立发现，单个通道查询失败不阻断另一个。
- 模型标识采用 `agent/<模型ID>` 与 `benefit/<模型ID>`，请求上游时还原真实 ID。
- 支持正文流、推理内容、工具调用参数分片、工具结果回传及 token 用量。图片仅在上游明确声明支持时启用。
- 模型上下文和输出上限来自当前账号的上游元数据；缺少关键字段的模型会跳过，并在设置页说明原因。
- 模型目录按账号和凭据版本缓存五分钟，额度缓存一分钟；手动刷新绕过缓存。重启后重新发现。
- 刷新失败保留本账号先前成功的模型目录。异常断流和 HTTP 200 业务错误均报告失败。
- 套餐没有可靠的按 token 价格，DSH 价格字段为零；这不表示所有模型免费。设置页额度仅指免费模型福利额度。
- 无自动账号轮换、自动签到、独立 OpenAI 服务或推理档位探测。

## 凭据与请求

AK/SK 使用 DSH 自带的 `ctx.credentials` 持久保存，记录键为 `dsh-connect-codearts/accounts`。沿用宿主凭据存储的文件保护和原子写入；插件不另建密钥文件，不将密钥写入普通配置。设置页仅返回 AK 末四位，保存后清空浏览器输入框。

请求使用 [Huawei Cloud SDK-HMAC-SHA256](https://support.huaweicloud.com/devg-apisign/api-sign-algorithm-001.html) 签名，并发送 DSH 的应用归属信息。仅访问以下固定服务，拒绝重定向：

- `snap-access.cn-north-4.myhuaweicloud.com`：聊天和 AgentCenter 订阅模型目录。
- `opengw.developer.huaweicloud.com`：免费模型目录、余额和签到。

AK/SK 的权限由华为云账号配置决定，请勿把真实密钥写入源码或提交到 Git。上游接口信息来自社区项目，账号权限、模型列表、限流与接口可用性仍由上游决定。

## 开发与验证

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:engine
```

宿主和客户端分别构建为 ESM 与 DSH 浏览器模块；后者的模块 ID 从包名派生。宿主 DSH 模块和 React 由 DSH 提供。

测试覆盖签名向量、双通道目录、账号持久化与隔离、工具调用往返、流式错误、取消、控制接口和设置页交互。引擎检查在离线 Cordis/DSH 环境加载构建产物，确认 provider、设置目录、控制路由和浏览器模块身份。

**真实账号验收尚未完成**：本项目当前验证使用离线模拟接口，未使用真实 AK/SK 测试上游聊天、签到、实际模型工具能力，以及 DSH Desktop 的完整交互。这些能力需要部署后使用自己的账号验收。

## 参考与许可

- [dsh-workbuddy-connect-functy](https://github.com/functy23/dsh-workbuddy-connect-functy/tree/a13f54e34d357024801ea36963d1ba5c87923ca1)：provider 组装、插件打包和设置接入。
- [codearts2api](https://github.com/Johnsheng1/codearts2api/tree/d813ca0456f23cd73bb3bbee16627bc2a40036f9)：CodeArts 接口、签名与通道信息。

MIT。来源与署名见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。
