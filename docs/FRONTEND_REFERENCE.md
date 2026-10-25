# God’s Eye View 交互参考与三国地图适配

## 参考快照

- 项目：[bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)。
- 查阅时间：2026-10-25。
- 查阅期间 GitHub API 返回的 main 最新 SHA：`abd81155f9ef89580ae0a42884444fb8f47c3339`。
- 查阅材料：README、`docs/media/hero-open-source-reveal.gif`，以及下表列出的界面源码。开发参考图只保存在临时目录，未打包进本项目。
- 许可核对：[LICENSE](https://github.com/bilawalsidhu/gods-eye-view/blob/abd81155f9ef89580ae0a42884444fb8f47c3339/LICENSE) 对源代码采用 MIT，同时明确第三方数据与资产分别适用各自来源条款。

本次参考设计与交互组织方式，未复制参考仓库的源文件或第三方资产。新增 `frontend/cockpit.js` 与 `frontend/cockpit.css` 为本项目独立编写。

## 具体映射

| 参考材料 | 采用的设计思路 | 三国项目实现 |
| --- | --- | --- |
| `src/ui/styles/foundation.css`，`src/ui/templates/scene-chrome.html` | 地图占据工作区、轻量视图状态、少量全局操作 | 保留 Leaflet 二维矢量地图，显示实际视图中心、缩放和原文序号；窄侧栏切换七个工作区 |
| `src/ui/styles/panel-surfaces.css`，`src/ui/templates/layer-panels.html` | 场景/图层和目标上下文面板分开，面板内部独立滚动 | 左侧语料统计、事件筛选与图层控制；右侧原文证据和本章线索；面板可收起 |
| `src/ui/styles/command-dock.css`，`src/ui/templates/command-dock.html` | 底部集中导航和风格控制 | 底部章节滑块、速度、播放、原文入口与墨色/宣纸主题 |
| `src/ui/styles/mobile-shell.css` | 全幅地图与底部按需面板 | 手机场景、时间轴、证据面板每次显示一个，保留地图操作区域 |
| README 中 keyless search / reset / clean view 交互 | 快速前往、复位、收起干扰信息 | 本地人物、地名和章节检索；地图复位；F 专注、Esc 退出；各功能按自身按钮状态工作 |

## 数据与功能边界

- 地图是二维 EPSG:3857 显示，点位继续采用已有坐标数据；未将界面样式描述为已实现三维地球、真实地形或卫星影像。
- 中国省、市、县仍采用用户提供的 2024 行政边界（42 / 388 / 2898 要素），保留随缩放切换及审图号标注。现代边界不是三国疆域。
- 图层开关只控制已有事件点、历史库候选和现代参照候选的显示；不会改变候选集合、地理编码、MED 或其他科研结果。
- 悬浮标注继续显示原文古地名词面；来自现代地名志的坐标明确标为现代参照。快速定位不会把多候选强行选为唯一坐标。
- 人物检索打开该人物自己的叙事轨迹；地名检索显示该条记录的来源与不确定性；章节检索保留真实源序号与原始章名。
- 查询只检索原有本地资料，不调用在线地理编码、LLM、实时数据或付费服务。开发时联网查阅参考项目与产品运行时的数据请求分开记录。
- 深浅主题同时更新 UI 与底图样式，切换主题保持视图中心和缩放；后续缩放切换行政图层时继续保持所选风格。

## 维护方式

`style.css` 保留已有文献阅读与工作区设计规则；`cockpit.css` 独立提供地图工作台和主题皮肤。`cockpit.js` 在 DOM 装载后组合原有控制节点，原有 ID、数据来源和功能路径继续可用。`app.js` 增加了主题、面板开启和图层显示的显式挂接点，未改动研究数据生成代码。

`scripts/check_frontend.cjs` 仍是统一浏览器验收入口，新增的工作台检查由 `scripts/check_cockpit.cjs` 承载。快速地名定位按地图显示中心与候选的屏幕偏移 ≤ 1.5 CSS 像素验证：Leaflet 视图可能发生像素量化，地名源坐标不做修改。

实测截图和逐项结果保存在 `outputs/ui/`。新增截图包括墨色/宣纸工作台、专注地图、快速检索、手机场景/时间轴/证据面板。
