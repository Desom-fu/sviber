# Translation notes (English / 简体中文 / 日本語)

Prefer these mappings when talking to the user or reading the UI. UI strings come from `json/i18n.*.json` and the help manuals; API names stay English camelCase / snake_case as in the macro API. Where the Japanese UI file has a clearly machine-mangled label, the **recommended** term is given for charting talk.

## Core nouns

| English | 简体中文 | 日本語 | Notes |
| --- | --- | --- | --- |
| Chart | 谱面 | 譜面 | The editable document. |
| Project | 工程 | プロジェクト | NW.js multi-chart folder. |
| Level (export) | 关卡 | レベル | Sunniesnow play package. |
| Music / audio | 音乐 | 音楽 | |
| Offset | 偏移 | オフセット | Audio time of beat 0. |
| Initial BPM | 初始 BPM | 初期BPM | |
| BPM change | BPM 变化 | BPMの変更 | |
| Bar line | 小节线 | 小節線 | |
| Beat | 拍 | ビート | |
| Subdivision | 细分 | 細分 | Timeline quantize grid. |
| Timing | 时间系统 | タイミング | |
| Metadata | 元数据 | メタデータ | title/artist/charter/difficulty… |
| Title | 标题 | タイトル | |
| Artist | 曲师 | アーティスト | UI ja uses アーティスト; charting often 曲師. |
| Charter | 谱师 | 譜面作者 | ja UI file shows クラブ設立 (wrong); use 譜面作者. |
| Difficulty | 难度 | 難易度 | |
| Difficulty name | 难度名 | 難易度名 | |
| Difficulty color | 难度颜色 | 難易度の色 | |
| Difficulty superscript | 难度上标 | 難易度上付き文字 | |

## Workspace

| English | 简体中文 | 日本語 |
| --- | --- | --- |
| Editor | 编辑器 | エディタ |
| Timeline | 时间轴 | タイムライン |
| Main field / stage | 主编辑区 / 舞台 | メインフィールド |
| Scroll view | 滚动视图 | スクロールビュー |
| Inspector | 属性面板 | インスペクタ |
| Channel lane | 通道轨道 | チャンネルレーン |
| Waveform | 波形 | 波形 |
| Spectrogram | 频谱图 | スペクトログラム |
| Bookmark | 书签 | ブックマーク |
| History | 历史 | 履歴 |
| Checks | 检查 | チェック |
| Heat map (density) | 密度热图 | ヒートマップ |
| Macro window | 宏窗口 | マクロウィンドウ |
| Macro console | 宏控制台 | マクロコンソール |
| Global macro | 全局宏 | グローバルマクロ |
| Project macro | 工程宏 | プロジェクトマクロ |
| Read-only | 只读 | 読み取り専用 |
| Live hosting | 实时托管 | ライブホスティング |

## Channels, snappees, selection

| English | 简体中文 | 日本語 | Notes |
| --- | --- | --- | --- |
| Channel | 通道 | チャンネル | Sometimes 频道 in casual speech; UI is 通道. |
| Current channel | 当前通道 | 現在のチャンネル | |
| Active (channel/event/snappee) | 启用 / 已启用 | 有効 | Predicate `active`. |
| Inactive / deactivate | 停用 | 無効 | Draft: excluded from stage/checks. |
| Activate | 启用 | 有効化 | |
| Hidden (channel) | 隐藏 | 非表示 | UI-only collapse. |
| Locked | 锁定 | ロック | |
| Selected | 选中 | 選択中 | |
| Snappee | 吸附器 | スナッピー | Also 吸附物 in some toasts. |
| Snap point | 吸附点 | スナップポイント | |
| Attach | 附着 | アタッチ | |
| Detach | 分离 | デタッチ | |
| Rectangular mesh | 矩形网格 | 長方形のメッシュ | |
| Radial mesh | 径向网格 | ラジアルメッシュ | |
| Parametric mesh | 参数网格 | パラメトリックメッシュ | |
| Regular polygon curve | 正多边形曲线 | 正多角形曲線 | |
| Bézier curve | Bézier 曲线 | ベジェ曲線 | |
| Circular arc | 圆弧 | 円弧 | |
| Pen curve | 钢笔曲线 | ペンカーブ | |
| Parametric curve | 参数曲线 | パラメトリック曲線 | |
| Playfield grid (preset) | 游玩区域网格 | プレイフィールドグリッド | Default new-chart snappee. |
| Transformation matrix | 变换矩阵 | 変換行列 | |

## Events

| English | 简体中文 | 日本語 | Notes |
| --- | --- | --- | --- |
| Event | 事件 | イベント | |
| Note | 音符 | ノーツ | tap/hold/drag/flick family. |
| Tap | Tap | タップ | UI keeps English in zh. |
| Hold | Hold | ホルド | |
| Drag | Drag | ドラッグ | |
| Flick | Flick | フリック | ja UI file has スイッチを入れる (bad MT); use フリック. |
| Bg note / background note | 墨点 | 背景ノート | en UI: "Bg note"; ja UI: 背景メモ. |
| Big text | 大字 | 大きなテキスト | |
| Grid | 网格 | グリッド | |
| Hexagon | 六边形 | 六角形 | |
| Checkerboard | 棋盘格 | チェッカーボード | |
| Diamond grid | 菱形网格 | ダイヤモンドグリッド | |
| Pentagon | 五边形 | 五角形 | |
| Turntable | 转盘 | ターンテーブル | |
| Hexagram | 六芒星 | 六芒星 | |
| Comment | 注释 | コメント | |
| Group | 分组 | グループ | |
| Clip | 剪贴片段 | クリップ | Chart-internal clip library, not OS clipboard. |
| Duration | 持续拍数 / 时长 | 持続時間 | Beats, not seconds, in event fields. |
| End time | 结束时间 | 終了時刻 | |
| Angle (flick) | 方向 / 角度 | 角度 | One angle per flick. |
| Location / position | 位置 | 位置 | |
| Anchor (group) | 锚点 | アンカー | Group only. |
| Text | 文本 | テキスト | |
| Background event | 背景事件 | 背景イベント | bgNote + patterns + bigText. |
| Background pattern | 背景图案 | 背景パターン | grid/hexagon/… |
| Perdurant | 有持续时长 | 持続あり | API `perdurant` / `perdurant?`. |
| Textable | 可带文本 | テキスト可 | API `textable`. |
| Movable | 可移动 | 移動可能 | API `movable`. |
| Tip-pointable | 可有提示点 | チップポイント可 | tap/hold/drag/flick only. |

## Tip points

| English | 简体中文 | 日本語 | Notes |
| --- | --- | --- | --- |
| Tip point | 提示点 / 游标 | チップポイント | Field label 提示点; status 游标. Both mean the same. |
| Tip point mode | 游标模式 | チップポイントモード | |
| Spawn type | 生成类型 | 生成タイプ | |
| Inherit | 继承 | 継承 | |
| Chain | 连锁 / 连接 | チェーン | Field 连锁; tipPoint.chain 连接. |
| Drop | 下落 / 分离 | ドロップ | Field 下落; tipPoint.drop 分离. |
| None | 无 | なし | |
| Tip point switch | 游标切换 | チップポイント切替 | Channel permutation at a beat. |
| Track (tip point) | 轨迹 | トラック | Follows switches, not raw channel id. |
| Relative / absolute | 相对 / 绝对 | 相対 / 絶対 | distance+angle vs location. |
| Seconds vs beats (tip time) | 秒 / 拍 | 秒 / 拍 | Mutually exclusive. |

## Macros / MCP

| English | 简体中文 | 日本語 |
| --- | --- | --- |
| Macro | 宏 | マクロ |
| JavaScript | JavaScript | JavaScript |
| Ruby | Ruby | Ruby |
| Sandbox | 沙箱 | サンドボックス |
| Snippet | 代码片段 | スニペット |
| Expression | 表达式 | 式 |
| Instance (pid) | 实例 | インスタンス |
| MCP server | MCP 服务器 | サーバー |
| Undo | 撤销 | 元に戻す |
| Redo | 重做 | やり直す |
| Stdout / stderr | 标准输出 / 标准错误 | 標準出力 / 標準エラー |
| CamelCase | 驼峰命名 | キャメルケース |
| Snake_case | 蛇形命名 | スネークケース |
| Rational | 有理数 | 有理数 |

## Capability queries (API → talk track)

| API | 简体中文 gloss | 日本語 gloss |
| --- | --- | --- |
| `movable` | 有位置 | 位置あり |
| `haveTime` | 有时间 | 時間あり |
| `haveChannel` | 有通道 | チャンネルあり |
| `perdurant` | 有持续时长 | 持続あり |
| `textable` | 可带文本 | テキスト可 |
| `tipPointable` | 可有提示点 | チップポイント可 |
| `group` | 是分组 | グループ |
| `background` | 是背景事件 | 背景イベント |

There is **no** `haveDuration` and **no** `haveText`.

## Direction names (angles)

| English alias | 简体中文 | 日本語 | Radians |
| --- | --- | --- | --- |
| right / r | 右 | 右 | 0 |
| up / u | 上 | 上 | π/2 |
| left / l | 左 | 左 | π |
| down / d | 下 | 下 | -π/2 |
| upLeft / ul | 左上 | 左上 | 3π/4 |
| upRight / ur | 右上 | 右上 | π/4 |
| downLeft / dl | 左下 | 左下 | -3π/4 |
| downRight / dr | 右下 | 右下 | -π/4 |

## API name mapping cheat sheet

| JavaScript | Ruby | 中文 talk | 日本語 talk |
| --- | --- | --- | --- |
| `currentTime` | `current_time` | 当前时间 | 現在時間 |
| `currentChannel` | `current_channel` | 当前通道 | 現在のチャンネル |
| `initialBpm` | `initial_bpm` | 初始 BPM | 初期BPM |
| `selectedEvents` | `selected_events` | 选中事件 | 選択イベント |
| `selectedSnappee` | `selected_snappee` | 选中吸附器 | 選択スナッピー |
| `tipPoint` / `tp` | `tip_point` / `tp` | 提示点/游标 | チップポイント |
| `tipPointSwitch` | `tip_point_switch` | 游标切换 | チップポイント切替 |
| `haveTime` | `have_time?` | 有时间 | 時間あり |
| `haveChannel` | `have_channel?` | 有通道 | チャンネルあり |
| `bgNote` | `bg_note` | 墨点 | 背景ノート |
| `bigText` | `big_text` | 大字 | 大きなテキスト |
| `bBang` | `b!` | 设定当前拍 | 現在拍を設定 |
| `toJSON` | `to_h` / `to_json` | 序列化 | 直列化 |

## Translation pitfalls

1. **Tip point** appears as 提示点 (fields) and 游标 (status/checks) in zh — same concept.
2. **Active/enable** vs **hidden** — 停用/無効 is content draft; 隐藏/非表示 is lane UI.
3. **Flick** — do not use the ja UI string スイッチを入れる in conversation; say フリック.
4. **Charter** — ja UI クラブ設立 is wrong; say 譜面作者.
5. **Bg note** — 墨点 (zh) / 背景ノート or 背景メモ (ja); English UI says "Bg note".
6. **Channel** index in macros is **1-based**; **Snappee** index is **0-based**.
7. Keep API identifiers in English when writing code; translate only for user-facing explanation.
