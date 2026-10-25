# Copilot (GPT-6.1 Sol) 访问 SharePoint 工作区深度技术实测报告

- **实测时间**: 2026-10-20 01:19:06 (UTC+8)
- **CDP 调试端口**: `127.0.0.1:9222`
- **激活模型**: **GPT-6.1 Sol**（已由 CDP 探针强制核验与切换生效）
- **目标工作区**: `/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/test`
- **对账状态**: **100% 成功检索并召回已上传文件**

---

## 一、提问内容（3 大刁钻技术实现质询）

```markdown
请查阅我们刚刚同步至公司 SharePoint 站点（站点：CMA-GBSC_BKGDOMAIN，文档库：AFRASIA）中共享工作区根目录下的独立工作区目录：
目标路径：/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/test

请调阅该工作区下的源码与技术文档，详细回答以下 3 个深入的技术实现问题：

【问题 1：并发控制与 Win32 原生原子替换】
在 WorkSpace/test/Library/CNNJI QUERY/shared/modules/JsygtBatch.psm1 中：
1. 为什么在后台 runspace 批量执行与前端高频轮询读取 state.json 时，单纯将文件共享标志设为 FileShare::ReadWrite 仍无法根治并发冲突？
2. 为什么使用 .NET 的 [System.IO.File]::Replace 会导致约 20.1% 的轮询被误报为“批次丢失（State=missing）”？其底层 Win32 API 存在怎样的两步改名真空时间窗口？
3. 源码中最终采用了哪一个 Win32 API 解决该问题？为什么该 API 的 P/Invoke 声明必须先用 [PSTypeName] 做 AppDomain 级的判存？

【问题 2：OCR 推理引擎与防御性自检】
在 WorkSpace/test/Library/CNNJI QUERY/tools/jsygt-ocr/OcrInfer.cs 中：
1. 类 CharsetCheck 为 --selftest 启动闸门定义的 GarbageLimit（碎片上限）与 DuplicateLimit（重复上限）阈值分别是多少？为什么允许 0 号索引之后存在整条为纯空白字符的条目（如 ' ' 与 U+3000）？
2. 在 OcrOptions 中，白名单掩码 AllowedChars 的默认值是什么？当 CTC 解码长度超过 ExpectedLength 时，算法具体采取了怎样的丢弃策略？

【问题 3：工作区工程治理与审查矩阵】
在 WorkSpace/test/AGENTS.md 与 WorkSpace/test/test/CNNJI-review-coverage-matrix.md 中：
1. AGENTS.md 中对 AI 在工作区根目录的写权限以及对 Library/ 目录的版本控制是如何规约的？
2. CNNJI-review-coverage-matrix.md 中列出了哪些核心审查维度与阻断策略？

请根据 SharePoint 实际上传的工作区文件进行详细对账并解答。
```

---

## 二、Copilot (GPT-6.1 Sol) 原始生成答复与引证来源

### 引证文件（由 SharePoint Substrate 召回）
1. `OcrInfer`（修改者: FU Vincent，时间: 2026/10/20）
2. `read-JsygtBatch.psm1-1792394944757`
3. `2026-09-21-state-missing-window`（修改者: FU Vincent，时间: 2026/10/20）
4. `AGENTS`（修改者: FU Vincent，时间: 2026/10/20）
5. `CNNJI-review-coverage-matrix`（修改者: FU Vincent，时间: 2026/10/20）

---

### 问题 1：并发控制与 Win32 原子替换
#### 1. FileShare::ReadWrite 为什么不够？
它解决的是句柄共享权限，不是完整内容的原子发布。批量模块快照明确记录：直接使用 `FileMode::Create` 时，截断旧文件与写入新内容之间存在窗口；写线程若被抢占，读者即使获准共享读取，也可能读到空内容或半截 JSON。因此，放开共享权限不能消除数据完整性冲突。

可见实现采用三层处理：
- 共享标志为 `FileShare::ReadWrite -bor FileShare::Delete`。
- 覆盖写先完整写入同路径旁的 `.tmp` 文件，再替换目标。
- 文件读写的 `IOException` 使用 `10×10ms` 有界重试。

关键区别：允许同时访问，不等于读者只能看到完整版本。

#### 2. File.Replace 为什么会误报 missing？
`2026-09-21-state-missing-window` 记录的调用链是：
```
写 state.json.tmp
→ File.Replace(tmp, state.json, state.json.bak)
→ 删除 state.json.bak
```
报告将 Windows 下的替换定位到 `ReplaceFileW`，并记录两步改名：旧目标→备份，新文件→目标。两步之间，`state.json` 这个目标名称短暂不存在。读侧将“文件不存在”解释为“批次不存在”，返回 `State=missing`；前端又将其视为终态，停止轮询。

历史实验依据如下：
- **改名阶段对齐实验**: 400 次写入，397 个缺失区间，全部位于 Replace 阶段；
- **备份文件证据**: 394/397 个缺失区间中 `.bak` 在场；
- **真空窗口**: 中位数 `0.968ms`，最大 `2.801ms`；
- **真模块高频读取**: 5932 次探测中，1192 次返回 missing，报告记为约 `20.1%`。

官方文档说明 `ReplaceFileW` 将保存新文件、重命名原文件、重命名新文件等步骤组合到一个函数中，但没有承诺这里所需的“目标名称始终可见”。毫秒级窗口的具体证据来自项目实验。

#### 3. 最终 API 与 AppDomain 判存
最终使用 `kernel32.dll!MoveFileExW`，参数为：
```powershell
[JsygtNative.Fs]::MoveFileExW($tmp, $Path, [uint32]0x1)
```
`0x1` 是 `MOVEFILE_REPLACE_EXISTING`。源码快照与报告将它作为单次改名替换方案；官方文档也确认该标志用于替换已存在的目标文件。

注册前检查：
```powershell
([System.Management.Automation.PSTypeName]'JsygtNative.Fs').Type
```
原因是 `Add-Type` 注册的类型在同进程 AppDomain 内共享，而 driver、worker runspace 各自可能加载模块。模块级 `$script:MoveFileExReady` 缓存不能代替跨 runspace 类型判存；重复注册同名类型会触发 `type already exists`。可见实现先检查类型，缺失时才执行 `Add-Type`。

此外，注册失败会缓存为不可用并回退 `File.Replace`；持续重写的状态文件由读侧 `20×10ms` 存在性重试兜底。该方案消除目标名真空，并对剩余访问失败进行有界重试。

---

### 问题 2：OCR 推理与防御性自检
#### 1. 阈值与空白条目
`OcrInfer` 中明确声明：
```csharp
public const int GarbageLimit = 16;
public const int DuplicateLimit = 8;
```
失败判断使用 `>`，所以达到 16 或 8 本身不触发对应失败条件；还必须满足字符表条目数等于模型类别数、索引 0 为 CTC blank 等其他条件。

**纯空白条目不是完全豁免**。索引 0 之后的单字符空白会同时增加 `Garbage` 和 `WhitespaceOnly`。之所以允许少量存在，是源码注释记录随附良好表中 `' '` 与 `U+3000` 是模型真实类别，良好表的垃圾统计为 2；采用阈值 16，而不是要求垃圾数为零。
因此：
- 索引 0 的空串是解码器使用的 CTC blank。
- 后续空白字符是字符表类别，不能简单当作索引 0 的替代品删除。
- 自检仍统计这些条目，只是容忍数量有限。

#### 2. 默认白名单与超长丢弃策略
默认值是：
```csharp
public string AllowedChars = "digits";
public int ExpectedLength = 4;
```
`digits` 掩码只允许 ASCII `'0'` 至 `'9'`，索引 0 的 blank 始终允许；非白名单类别在选择预测类别时被排除。

CTC 解码后，若 `ExpectedLength > 0` 且字符数超长，实际算法是：
1. 按候选字符置信度降序排列其索引。
2. 保留前 `ExpectedLength` 个索引。
3. 将保留索引按原位置升序排序。
4. 重建字符及置信度列表。

所以它是**删除低置信度字符、保持剩余字符原顺序**，不是截取前四位，也不是按置信度重新排列输出。短于期望长度时，这段代码不补齐字符。

---

### 问题 3：工程治理与审查矩阵
#### 1. 工作区目录规约
文档原文引用如下：
- “AI 严禁在工作区根目录写任何文件。所有代码、文档、配置文件必须创建在二级子目录内（如 test/ 下）。”
- “参考资料放入 Library/ 文件夹，不纳入版本控制。”
- “根目录仅允许以下文件存在：AGENTS.md、.gitignore、README.md。”

#### 2. 覆盖矩阵的核心维度与验收阻断点
`CNNJI-review-coverage-matrix` 实际包含以下覆盖分类：
- **已精审**: 批量模块 D–H 有已见报告正文证据，但不扩大为全文件验收
- **待主控复核**: Batch A–C、Client、Captcha、Server、OcrInfer 多个切片有计划或报告记录，尚未逐份核验
- **仅斥候**: 架构侦察不能升级为深度审查
- **未审查**: 准确含义为未确认精审证据，不是断言从未有人检查
- **非源码资产**: 模型、字符表、夹具、配置、历史文档、日志及构建产物分开统计

其正文体现的验收阻断点是：
1. 结构检索、文件存在、SUCCESS 标签不能证明精审完成。
2. 测试文件存在或建议切片不能证明生产分支覆盖，更不能证明测试通过。
3. 建议区间不等于已核实的函数闭合范围。
4. 历史报告、补丁和日志不能自动证明当前源码状态。
5. 正式落盘、回读、完整函数范围及全量报告证据对账仍有未完成项。

#### 3. 实际上传内容中的重要差异
**矩阵文件现在能够被检索并读取，但其正文仍保留“指定覆盖矩阵尚未落盘、未回读核验”的历史交付说明，同时顶部标记 SUCCESS**。这证明上传内容存在状态口径差异，不能据顶部标签认定全项目审查已完成，也不能将历史“未落盘”直接解释为 SharePoint 当前没有该文件。

---

## 三、结论与验证评价
1. **工作区访问能力**: **100% 验证通过**。Copilot 准确检索到了上传到 SharePoint `WorkSpace/test` 的 `JsygtBatch.psm1`、`OcrInfer.cs`、`AGENTS.md` 和 `CNNJI-review-coverage-matrix.md` 等核心文件。
2. **GPT-6.1 Sol 表现**: **极高水准**。回答不仅准确说出了具体的系统调用（`MoveFileExW`、`0x1`、`ReplaceFileW` 毫秒级真空窗口）、具体的常量（`GarbageLimit=16`、`DuplicateLimit=8`、`AllowedChars="digits"`），甚至还指出了代码中极其微妙的排序保序算法（降序挑出 TopN 后按原始索引升序重建），并客观指出矩阵文档中历史残留的口径矛盾。

