# 生成器输入

生成器处理已分析的JSON，不自动推断需求或行情。示例数值只用于演示。

```json
{
  "project_name": "示例项目",
  "scope_note": "一期；人民币；人工元/小时；工时为人时；未税计价。",
  "tax_rates": {"软件": 0.06},
  "rows": [
    {"module": "客户管理", "description": "客户列表和搜索界面", "role": "前端开发", "kind": "labor", "unit_rate": 80, "hours": 16, "tax_group": "软件", "notes": "复用现有组件。"},
    {"module": "客户管理", "description": "客户增改与查询接口", "role": "后端开发", "kind": "labor", "unit_rate": 90, "hours": 20, "tax_group": "软件", "source": "需求文档第二节"}
  ]
}
```

- project_name必填；scope_note写范围、费用口径及影响价格的假设。
- tax_rates为税组名称到0至1数值/null的对象，至少一组。每条row的tax_group必须已定义。脚本在同页底部生成可编辑税率格，税后公式引用它。
- rows至少一项；按期望业务模块顺序写，脚本把同名模块稳定聚到一起。同名模块须同一业务范围。
- 公共字段：module、description、tax_group必填；notes可空；source可写必要来源文件与章节，追加到备注建议。
- 人工：kind=labor；role必填；unit_rate为元/小时数值/null；hours为人时数值/null。不直接写人天。
- 采购/服务：kind=hardware或service；quantity为正数；unit_price为未税单价数值/null；unit为数量单位。role由脚本确定，人工列空白。notes记录规格、来源、日期和价格口径；来源含税时先换算。
- 不接受负值或未定义税组。报价调整按确认费率或范围表达，不加入隐藏折扣。

使用环境提供的Node/Python执行SKILL.md中的命令。预览、内部JSON和校验数据不进入客户Excel。校验器只检查保存的格式及计算，不证明需求完整性、行情合理性或税率适用性。
