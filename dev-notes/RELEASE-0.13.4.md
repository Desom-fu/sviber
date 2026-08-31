# Release 0.13.4

本版本修复属性面板中多选 note 修改游标生成类型为"连接"时的错误行为：

- 修复：多选 note 在属性面板将游标生成类型改为"连接"（chain）时，之前会错误地将所选 note 连接成一条游标路径（第一个设为 chain，其余设为 inherit），而非将每个 note 的游标生成类型分别设为 chain。现在改为与其他属性一致的行为，即分别设置每个选中 note 的 `tipPointSpawnType` 为 `chain`。
- 移除 `app-property-editing.js` 中不再需要的 `connectSelectedTipPointChain` 导入。
