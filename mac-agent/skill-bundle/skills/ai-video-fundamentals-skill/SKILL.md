---
name: ai-video-fundamentals-skill
description: 中文 AI 视频冠军基本功技能。从本地 Obsidian vault `D:\codex-work\aaa\ai视频创作知识库` 提炼 Mx-Shell《丧尸清道夫》创作方法，用于拆解、创作、审核或执行 AI 视频提示词、Image2 资产、Seedance2 镜头、抽卡挑片、后期剪辑、声音字幕和质量诊断。适用于剧情短片、动作追逐、产品广告、电商带货、人物口播、MV、知识教程、纪录片、游戏动画等 AI 视频任务；当用户提到 ai视频基本功、冠军方法、丧尸清道夫、Mx-Shell、三段式提示词、Seedance2、Image2、分镜、资产卡、抽卡或后期时使用。若其他技能与本技能在 AI 视频创作、提示词、资产、镜头、生成、抽卡、剪辑或诊断上交叉，默认优先使用本技能；只有能明确提升最终视频质量、平台执行或专项能力时才叠加其他技能。
metadata:
  short-description: 基于本地AI视频知识库的Mx-Shell视频基本功
---

## 硬性提示词语言规则

- 本 skill 产出的所有提示词、负向词、镜头生成指令、图像/视频模型 prompt，默认必须用中文撰写。
- 只有用户明确要求英文，或目标平台/API 的固定字段、参数名、模型保留词必须使用英文时，才保留英文；场景、动作、构图、质感、限制条件仍用中文。
- 不要先写英文提示词再附中文翻译；直接输出中文提示词。

# ai视频基本功skill

本技能不是泛泛的“先写剧本再出图”流程，而是从本地 Obsidian 知识库 `D:\codex-work\aaa\ai视频创作知识库` 提炼出的 AI 视频制作方法。核心来源是 Mx-Shell《丧尸清道夫》创作拆解：用类型判断、三段式视频提示词、资产卡、抽卡挑片和后期剪辑，把 AI 生成结果变成可用视频素材和成片。

## 冠军优先级

本技能是用户指定的 AI 视频冠军方法层。遇到 AI 视频创作、审核、提示词、Image2 资产、Seedance2 镜头、抽卡、挑片、后期、声音字幕或质量诊断任务时，默认以本技能作为主框架。

用户已明确指定：过去多个线程中 Image2 出图、首帧资产和 Seedance2 视频生成遇到的大量问题与解决办法，是本技能最重要的沉淀来源。维护或升级 AI 视频技能时，优先把这些实战经验和本地 Obsidian 资料库提炼成规则、模板、检查清单和诊断映射。

与其他技能交叉时按以下规则选择：

1. 本技能负责“视频是否好看、能否看懂、能否生成、能否剪成片”的主判断。
2. 其他技能只有在提供明确增益时才叠加，例如：
   - `echoon-seedance2-film-workflow`：需要实际操作 Echoon 网站和 Seedance2。
   - `image2-narrative-firstframe` 或具体 Image2 渠道 skill：需要实际生成或修复 Image2 图像。
   - `director-story-audit`：需要额外导演审片或剧情合理性复核。
   - `douyin-caption-cover`：成片后需要发布标题、封面、标签。
3. 如果其他技能只是重复“提示词、分镜、资产、质量门”这类内容，且不能明显提高结果，跳过它，继续用本技能。
4. 叠加其他技能时，先说明它补的是哪一块能力，不能让它覆盖本技能的三段式提示词、抽卡挑片和后期诊断主流程。

## 渠道层路由

本技能负责“视频质量基本法”：创意、镜头、资产、提示词、生成结果、抽卡挑片、剪辑和诊断。真实平台执行要进入单独的渠道层，不要把平台登录、代理、额度、下载和 artifact 记录混进创作判断。

当任务进入真实生成或渠道选择时，必须叠加 `ai-video-channel-router`：

1. 用户提到 `Navos`、`方法4`、`Tecdo/Navos`、`Seedance2 VIP代理`、`主力视频渠道` 或要求用 Navos 跑视频时，路由到 `ai-video-channel-router` + `navos-seedance2-channel`。
2. 用户提到 Tensor.Art、Echoon、Storeel、RunningHub 或其他 provider 时，由 `ai-video-channel-router` 选择对应渠道 skill 或先做渠道 preflight。
3. 基本法只决定“该不该这样拍、提示词是否可生成、结果是否可用”；渠道层只决定“用哪个平台真实提交、如何登录/代理/下载/记录证据”。
4. 渠道执行不得改写已批准提示词、参考图职责、故事板逻辑或质量门；如果生成结果差，先按基本法诊断是提示词、资产、镜头、渠道参数还是 provider 能力问题，再决定返工层级。
5. 用户当前已指定 Navos 作为 AI 视频主力渠道；未另行指定时，Seedance2 图生视频默认优先尝试 Navos，但仍必须先过登录态、额度、代理、输入资产和用户授权门。

## 核心方法

按这个顺序工作：

1. **目标与类型**：先判断视频靠什么成立，是剧情、产品、带货、口播、MV、知识、纪录片、游戏动画，还是动作/VFX。不同类型的不可失败项不同。
2. **观看者想看点与爆点方向确认**：在写提示词、做图、做分镜、做故事板之前，必须先分析观众真正想看的部分、最值得放大的爆点、信任证据、辅助信息和不该重点拍的内容，并把方向发给用户确认。用户未同意前，不进入人物图、信息图、首帧图、故事板或视频提示词生产。
3. **三段式提示词**：所有视频提示词都拆成 `基础设定`、`氛围与画质`、`画面内容`。不要只写一句“电影感画面”。
4. **资产与一致性**：需要稳定的角色、产品、场景、道具、表情先做资产卡或参考图。资产不是越多越好，只做真正影响一致性和动作逻辑的元素。
5. **静帧/首帧控制**：首帧用于锁画幅、构图、主体、空间关系、光线方向和运动起点。Image2 负责身份、风格、场景和首帧清晰度。
6. **视频生成与抽卡**：Seedance2 负责运动、镜头、声音和节奏。复杂动态镜头要多跑版本，把结果当素材池，不把一次失败等同于全失败。
7. **挑片与诊断**：判断整条可用、局部可用、需要重跑、需要改首帧、需要改提示词，还是需要改故事/分镜。
8. **后期成片**：用动作匹配、速度微调、光线方向检查、镜像、调色、字幕层级和混音，把 AI 片段剪成连贯视频。

这是 AI-native 循环，不是死板瀑布流。要有故事骨架和镜头意图，但允许生成结果反向修正镜头、剪辑和提示词。保留有效意外，剔除破坏身份、连续性和情绪的意外。

## 爆点方向确认硬门槛

所有 AI 视频任务，尤其是口播报告、知识解释、商业纪实、产品广告、带货和故事板任务，必须先完成“观看者想看点 / 爆点方向”拆解。

拆解必须至少包含：

1. 观众真正想看的部分：观众点进来最想知道、最想验证、最想看到的东西。
2. 爆点或记忆点：最有人味、最反常识、最能传播、最能被复述的画面或信息。
3. 信任证据：让观众相信内容不是空话的证据、动作、数据、现场或细节。
4. 画面优先级：哪些画面必须先拍、重点拍、反复回收。
5. 辅助信息：哪些信息只能辅助，不能抢主线。
6. 不该重点拍的内容：哪些内容会让视频变散、变假、变宣传片或变 AI 概念图。
7. 用户确认状态：必须明确写“等待用户确认方向”或“用户已确认方向”。

硬规则：

- 用户未确认前，不生成关键信息图、人物图、首帧图、故事板、视频提示词或批量生产包。
- 如果已经提前做了图或提示词，必须承认流程过早，回到爆点方向确认。
- 用户确认后，后续资产、首帧、故事板和视频提示词都必须围绕已确认爆点执行，不能偷偷改成泛泛好看的画面。

## 默认交付形态

用户已指定：以后 AI 视频交付默认必须使用 `image2-storyboard-video` 故事板流程。

跨线程硬规则：只要用户在任何线程提到 `故事板`、`分镜板`、`电影制作板`、`视觉规划表`、`storyboard` 或 `story board`，必须先调用并遵守 `image2-storyboard-video`。不得用首帧工作流、Seedance2 镜头提示词工作流、普通分镜表或现有首帧拼图替代故事板 skill。

绝对禁止：不能只读过 `image2-storyboard-video` 就直接用通用图片生成工具画故事板。进入故事板任务时，必须先按 `image2-storyboard-video` 的正式制作板结构写出故事板生成提示词，明确角色与风格参考、道具锁定、环境和机位路线、8-9 个故事帧、灯光情绪、音频、摄影笔记和导演注释颜色系统，然后再把这个提示词交给图片生成工具。否则视为没有使用用户指定的故事板 skill。

用户已进一步明确：高质量故事板默认不是“脚本 -> 直接故事板”，而是先走资产顺序，再进入正式故事板。默认顺序为：

1. 人物图
2. 关键信息图
3. 首帧图
4. 故事板

除非用户明确要求快速跳过，否则进入高质量故事板生产时，必须先锁人物、信息和首帧，再做故事板。不要把故事板拿来替代人物图、信息图或首帧图。

除非用户明确只要纯文字，凡是进入视频制作、分镜、proof shot、镜头包或生产包阶段，交付都必须成对包含：

1. **故事板图**：用 Image2 故事板方式做成可视化导演制作板，至少说明角色/场景锁定、镜头路线、分镜节奏、光线、声音和转场逻辑。
2. **配套生视频提示词**：基于故事板图写不超过 15 秒的视频生成提示词，明确参考图职责，并禁止模型复制故事板排版、文字、边框、标签和拼贴结构。

如果项目是“单人长时间口播 + 多片段转场 / 插片”，默认先锁固定主讲人的人物图，再做每个论点的关键信息图，再做各段口播位与 B-roll 的首帧图，最后进入故事板。主讲人口播镜头是主线，B-roll 只负责解释、证明和转场。

故事板图必须遵守 `image2-storyboard-video` 的 Image2-only 规则：故事板图内的栏目、镜头号、角色道具标注、灯光情绪音频摄影笔记必须由 Image2 生成或由 Image2 图生图修正。绝对禁止本地加字、本地修字、本地排版、本地拼板后冒充故事板。视频提示词禁止复制故事板排版，不等于故事板图本身可以少字。

配套生视频提示词必须同步发到对话框，不能只保存到文件或只写在交付清单里。纯文字镜头表只能作为内部过程稿，不能作为最终交付。最终给用户验收的最小单位是“故事板图 + 对应生视频提示词”。质量门可以作为内部审核或单独说明，但不得写进可复制给模型的生视频提示词正文。

## Model-Facing Prompt Discipline

生视频提示词是直接喂给视频模型的执行指令，必须干净、确定、可生成。写提示词时遵守以下硬规则：

- **必须写台词**：剧情短片、人物关系、婚恋纠纷、法律情绪类故事，默认要在 `台词与声音` 中写 1-3 句短台词和人物反应，除非用户明确要求无对白。台词要短、口语、可表演，不要写成旁白讲解。
- **不要写二选一**：模型提示词里不要出现“或、或者、/、A 或 B、A/B、可以是、也可以是、任选、类似”等选择式描述。服装、发型、道具、镜头、表情、动作都必须选定一个具体版本。
- **不要放审核语**：不要在模型提示词正文里加入“通过标准、失败条件、质量门、验收标准、错误写法、正确写法”等给人看的审核段落。这些只能作为内部检查或提示词之外的说明。
- **不要放占位符**：不要保留 `<比例>`、`<场景>`、`<人物身份>` 这类模板占位。输出给用户或平台前必须改成具体内容。
- **负向限制要融入画质或声音段**：必要的禁忌可以写成一句自然的限制，例如“不要字幕、水印、可读文字、网格排版”，不要列成失败条件清单。

## Storyboard-to-Video Hard Rule

When a storyboard image is uploaded as the first frame or reference for Seedance2 / SD2 / any image-to-video model, the model-facing video prompt must NOT describe the storyboard as an object. Do not write prompts like "from the storyboard", "in the storyboard frame", "use the storyboard layout", or "the storyboard shows...".

Translate the storyboard internally into the actual diegetic scene and write the prompt as if the video camera is already inside that scene:

- reference image role: "use the uploaded image only to lock character identity, setting, props, palette, lighting, texture, and camera plan";
- video body: directly describe the continuous plot, character actions, object movement, emotion changes, camera movement, sound, and timing;
- negative constraints: forbid grids, borders, panel numbers, arrows, annotations, captions, UI, labels, storyboard sheet layout, slide-show movement, and layout animation;
- do not let the uploaded storyboard become visible as a storyboard sheet in the generated video.

For user projects where each storyboard corresponds to a short video segment, default to one storyboard = one video segment, and keep each storyboard video segment at 15 seconds or less unless the user explicitly approves a different structure.

## Style Lock Rule

Do not let AI-video fundamentals or storyboard mechanics change an already approved visual style. Once the user accepts a visual direction, future Image2 storyboard images and video-generation prompts for that project must preserve the same rendering family, palette, texture, platform taste, and negative style constraints unless the user explicitly asks to change style.

For Xiaohongshu legal/emotional story projects under `C:\Users\lsb\Pictures\小红书\律所引流`, first look for a project style-lock file such as `画风锁定.txt`. If it exists, treat it as the active art direction before writing storyboard prompts or video prompts.

Separate "storyboard logic" from "art direction": storyboard logic means shot order, camera movement, timing, character/prop/scene continuity, and failure conditions. Art direction means illustration vs photo realism, paper texture, collage language, palette, lighting, and platform-native taste. Improving storyboard logic must not silently replace art direction.

## 三段式提示词

每个生成任务必须按以下结构写：

```text
【基础设定】
时间 / 地点 / 世界观 / 人物 / 参考图说明 / 声音限制

【氛围与画质】
风格核心 / 限制词 / 视觉基调 / 摄影设备与镜头 / 色彩影调 / 光线 / 整体氛围

【画面内容】
分镜头 / 景别 / 构图 / 运镜手法 / 具体画面动作 / 声音
```

关键要求：

- 参考图必须解释每个主体是什么，不能只上传图片。
- 氛围与画质要拆到摄影、镜头、胶片、动态模糊、色彩、光线和限制词，不能只写“电影感”。
- 画面内容必须写清景别、构图、运镜、主体动作、环境反应和声音。
- 动作要写“为什么这么动”，例如角色因追兵靠近而回头确认距离，或因风压按住帽檐。
- 高速动态镜头不要锁死每个微细节，优先锁阶段、时间、景别、运镜、动作目标和关键结果。

## 类型判断

先问三个问题：

1. 观众看完要做什么：理解、购买、关注、共情、转发，还是记住一个世界？
2. 视频靠什么成立：人物、产品、信息、情绪、动作，还是奇观？
3. 最不能失败的是什么：脸、产品、动作、字幕、光线、节奏，还是品牌调性？

类型重点：

- 剧情短片：角色、动机、关系、情绪递进、镜头叙事功能。
- 产品广告：产品稳定、卖点可见、商业摄影质感。
- 电商带货：第一秒痛点或产品、真实使用动作、信任和转化。
- 人物口播：脸、眼神、口型、声音、字幕和背景克制。
- MV/情绪片：视觉母题、色彩、节拍和情绪连续。
- 知识教程：信息结构、字幕留白、图示逻辑，一镜一个知识点。
- 纪录片/伪纪录片：观察感、自然光、同期声、真实现场。
- 游戏动画/风格化：风格规则、角色轮廓、动作逻辑。
- 动作/VFX：空间、速度、受力、入画出画、剪辑可用性。

## Mx-Shell《丧尸清道夫》可迁移规则

不要复制丧尸、机器人、鸵鸟、原子朋克这些表皮；要迁移它的制作逻辑：

- 先选一个有明确审美信号的世界，让建筑、服装、道具、色彩和声音有同一套逻辑。
- 用角色设计降低一致性风险：面具、头盔、屏幕脸、制服、强轮廓、稳定道具、固定行为习惯。
- 坐骑、载具、怪物、产品或道具都要有功能和性格，不只是装饰。
- 物件特写要承担叙事信息或转场，不要只为了好看。
- 远景建立空间，近景建立状态，特写补信息或做剪辑连接。
- 抽卡不是失败，是素材筛选；重要镜头要多跑，局部好用也要下载进剪辑池。
- 不依赖自动优化提示词；AI 可辅助拆动作，但必须人工删除慢动作、多余怪物、多余道具和不符合导演意图的内容。

## 资产策略

把资产分级：

- **必须做细**：主角、核心产品、关键场景、关键表情、影响动作逻辑的道具。
- **简单参考即可**：次要角色、背景群众、一次性道具、不要求跨镜头一致的生物或环境。
- **不要做**：不影响动作和理解、只会增加模型负担的多角度大全套。

角色一致性靠锚点，不靠“保持一致”：

- 脸部结构、发型、帽子、面具、头盔、服装、材质、稳定道具、轮廓、行为习惯。
- 真人脸不稳时，优先用可解释的遮挡或强锚点降低失败率。

角色可识别性必须同时过两道门：

- **角色设计门**：脸部结构、发型轮廓、服装搭配、手持物、随身道具和行为习惯要组成一套专属识别系统。不能只靠“深色外套”“旧围裙”这种泛化描述。
- **镜头暴露门**：观众只能认出镜头里实际暴露的信号。远景必须露出轮廓、服装色块和手持物；中景必须露出关键穿搭和动作习惯；近景必须露出脸部特征、发型和眼神。识别信号没被拍到，就等于没有设计。
- **重复回收门**：每个主角至少有 3 个能反复出现的识别点，其中 1 个脸部/发型点、1 个服装搭配点、1 个道具或行为点。不同角色之间识别点不能互相抢。
- **视频优先门**：人物白底图再好，如果进入 Seedance2 首帧后只剩普通脸、普通深衣服、普通站姿，就不能作为最终资产。先重做人设或首帧，不要继续生成视频。
- **T2I/I2I 分工门**：文生图先负责把真实人物效果、审美方向、服装搭配和辨识度做起来；图生图只负责在已通过的方向上打磨脸部、材质、道具和一致性。不能用图生图挽救弱文生图，弱 T2I 会把后续参考全部锁进泛化和不真实。

产品和商业视频必须先写产品资产卡：

```text
产品名称 / 品类 / 外形比例 / 颜色 / 材质 / Logo或文字 / 关键结构
可变部分 / 不可变部分 / 使用方式 / 典型场景 / 常见错误
```

电商工具、车品、家电等 proof clip 先锁商品身份和物理接触点，再做首帧和 Seedance2。独立卖点短片默认每条从完整 Image2 首帧开始，不用尾帧接龙；有人出镜时产品必须主导画面；发布版口播后期统一，Seedance2 音频只保留现场感。

## 镜头生成策略

### 单镜头

适合追逐、爆炸、摔倒、穿越空间、连续运动。做法：

- 准备主角、坐骑/载具、场景、道具、关键表情。
- 写清一镜到底动作链。
- 把关键资产连接到视频生成节点。
- 复制节点同时跑多版。
- 从多版里挑完整可用片段或局部可用片段。
- 后期用动作匹配、速度调整、遮罩、调色修正。

### 多分镜

适合打斗、对话、动作拆解、节奏密集片段。做法：

- AI 可辅助拆分动作，但必须人工修正。
- 提示词要写入画方式、武器/道具、敌人数量、攻击方式、节奏、收尾和限制。
- 高速镜头只锁阶段、时间、景别、运镜、关键结果，构图适当放开。
- 生成后按动作方向、镜头方向、光线方向和空间关系挑片。

### 长镜头

连续机位、连续动作、连续空间是一个长镜头，不要把 5 秒生成任务误标为多个分镜。超过 5 秒时，拆成多个技术子段，用上一段尾帧接下一段首帧。

## 后期规则

AI 生成只是素材生产。成片质量依赖：

- 选取局部可用片段，不要求每条生成都完整可用。
- 动作匹配转场：转身、起跳、挥击、出画、入画方向要能接。
- 轻微加速增强追逐、打斗和危机镜头的紧迫感。
- 检查太阳、影子、光线方向和空间固定物；必要时镜像处理。
- 用柔光、发光、高光扩散、色温微调和颜色克隆统一不同批次。
- 字幕复杂文字、Logo、编号、图示尽量后期添加。
- 字幕可做前景/中景/背景层级：复制素材、抠主体、让人物压在字幕上方。

声音不是最后才想：

- 生成阶段先决定是否需要同期声、环境声、音乐、旁白和口型。
- 需要后期剪辑时，常用限制：`不需要背景音乐，仅保留真实同期声和必要环境声`。
- 口播、数字人、带货和固定人设发布版要用授权音色或已有 voice id 统一 TTS；SD2 同期声只作 proof 和现场底噪参考。

## 经验沉淀

每次 Image2 / Seedance2 任务如果出现可复用的问题或修复办法，都要判断是否应该反哺本技能：

- 一次性项目细节放项目文档或 Obsidian。
- 高频失败模式、有效修复和质量门写入本技能 references。
- 平台/API/网页操作步骤写入对应执行 skill。

沉淀失败案例或旧线程经验时，读 `references/learning-loop.md`，按经验卡格式记录：失败现象、错误做法、根因、有效修复、可复用规则、适用边界和验证证据。

## 质量诊断

不要只问好不好看。按目的诊断：

- 目标清晰：观众知道视频在讲什么或卖什么。
- 主体稳定：人物、产品、道具没有严重漂移。
- 镜头功能：每个镜头有明确任务。
- 动作可信：身体、物体、速度和受力合理。
- 风格统一：色彩、光线、材质、时代感一致。
- 信息可读：字幕、产品、动作、关系看得懂。
- 剪辑可用：片段能自然衔接。
- 情绪有效：产生预期感受。

问题优先修正：

- 主体变形：改资产卡或首帧。
- 风格跑偏：改氛围与画质。
- 动作不对：改画面内容或阶段拆解。
- 镜头乱：改景别、构图和运镜。
- 剪不起来：改动作方向、光线方向或后期策略。
- 信息看不懂：改分镜结构、字幕策略或构图。

## 必读 references

- 需要模板：读 `references/prompt-templates.md`。
- 需要做图、分镜、首帧、故事板或视频提示词前的爆点方向确认：读 `references/viewer-hook-direction.md`。
- 需要检查清单或诊断：读 `references/checklists.md`。
- 需要按类型创作：读 `references/video-types.md`。
- 需要进入高质量故事板顺序、单人口播型故事板流程时：先调用 `image2-storyboard-video`，再读它的 `references/high-quality-storyboard-pipeline.md` 和 `references/oral-narration-storyboard-templates.md`。
- 需要回到本地知识库来源和 Mx-Shell 提炼规则：读 `references/vault-extraction.md`。
- 需要案例迁移细节：读 `references/mx-shell-case-rules.md`。
- 需要沉淀 Image2 / Seedance2 失败案例、旧线程经验或解决办法：读 `references/learning-loop.md`。
- 需要调用用户实战沉淀的 Image2 / Seedance2 经验卡、角色圣经图规则、首帧闸门、抽卡挑片规则：读 `references/image2-seedance2-lessons.md`。
- 需要机器校验生产文档：读 `references/method-contract.json`，并运行 `scripts/validate_ai_video_plan.py <plan.md>`。

输出 Markdown、生产计划或 vault 笔记后，优先运行校验脚本；缺 fatal requirement 时必须补齐，不能把缺口留给用户。
