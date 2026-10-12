# 综合报价系统

综合报价系统是一套用于软件项目需求分析和功能清单报价的 Codex Skill。它以资深项目经理、产品经理和架构师的视角，从需求文档、会议记录及现有报价中筛选本期范围，拆分功能与实际参与工种，生成统一格式的单工作表 Excel 报价清单。

适用于互联网软件、工业软件、科研软件、SaaS、PaaS及配套基础硬件采购。

## 中文演示页面

[打开综合报价系统落地页](https://kaisong2014.github.io/MyProjects/)

页面提供三组报价流程动效、五种需求场景，以及纯静态的本地体验：读取文字文档、手动确认功能清单、调整人工与采购参数、计算分税组总价并下载单工作表报价。文档只在浏览器内处理，不上传服务器。体验页没有接入模型，完整智能需求分析请使用下方技能。

页面源码和部署说明见 [docs](docs/README.md)。

## 核心能力

- 提取需求并识别本期、二期、可选、已有能力及冲突项。
- 按可验收功能拆分模块，按实际工种估算人时，减少共用能力重复计价。
- 复用已有设计、接口、平台及算法，选择满足需求的架构，避免无依据的高配置报价。
- 统一人工、采购和税费口径，缺失参数显示“待确认”。
- 固定列名、字体、对齐、合并和颜色规则，保留可调整的 Excel 公式。

## 严格报价格式

最终只保留一张名为 `报价清单` 的工作表，九列名称及顺序固定为：

```text
序号｜功能模块名称｜功能模块描述｜工种｜人工单价｜工时｜模块总价｜模块合计｜备注建议
```

所有内容使用宋体12磅（小四）。正文无填充，不加粗、不倾斜、不加下划线；只有表头与税前、税后总价的金额格允许深灰填充。指定五列水平居中，其他列向左对齐，内容垂直居中并完整换行显示。同模块名称及对应合计分别纵向合并，总价不重复累加模块小计。

## 快速使用

将 [技能目录](skills/comprehensive-quotation/) 复制到项目 `.agents/skills/` 或个人 `~/.agents/skills/`，保留其中的相对路径。[官方技能目录说明](https://learn.chatgpt.com/docs/build-skills)。

提交需求文档并输入：

```text
使用 $comprehensive-quotation 分析附件，拆分一期软件功能及必要硬件。
采用已确认的费率和税率，生成单工作表 Excel 报价清单。
缺失参数标为待确认，不把二期、可选项和已有能力重复计入价格。
```

也可以使用 `$skill-installer` 从本仓库的 `skills/comprehensive-quotation` 目录安装。

## 文档与示例

| 内容 | 入口 |
| --- | --- |
| 完整介绍、安装与运行说明 | [技能 README](skills/comprehensive-quotation/README.md) |
| 技能工作流程及严格规则 | [SKILL.md](skills/comprehensive-quotation/SKILL.md) |
| 估算与价格口径 | [estimation.md](skills/comprehensive-quotation/references/estimation.md) |
| JSON 输入格式 | [input-schema.md](skills/comprehensive-quotation/references/input-schema.md) |
| 可编辑示例报价表 | [quotation.xlsx](skills/comprehensive-quotation/examples/quotation.xlsx) |
| 示例报价输入 | [quote.json](skills/comprehensive-quotation/examples/quote.json) |
| 五份 Word 测试需求 | [tests](skills/comprehensive-quotation/tests/) |
| 测试方法和预期检查项 | [test-guide.txt](skills/comprehensive-quotation/tests/test-guide.txt) |

## 运行条件

附带生成器使用 Node.js 和 `@oai/artifact-tool`，需在提供该依赖的工件环境中执行；仓库不包含该依赖或本机运行时。Python 校验器只使用标准库。完整命令见技能 README。

测试材料覆盖互联网SaaS、工业软件与硬件、科研软件、PaaS、冲突需求及缺失参数。示例费率、税率、设备型号和采购价均为虚构测试参数，不代表实际行情或正式项目报价。
