# 致谢与引用

## 交互设计参考

感谢 [`wonton1984/sanguo-map`](https://github.com/wonton1984/sanguo-map) 作者公开《三国演义》时空互动地图。本项目从中获得地图、时间轴、阅读器与人物轨迹交互组织方面的设计启发。

本项目的数据处理链独立构建：使用另行提供的 119 章 EPUB 转换文本、自己的词典和规则抽取流程、His-Geo 地理编码适配及本地 GIS 分析。参考项目中人工整理的事件、时间、坐标、人物行踪、图片、历史对照和边界数据未导入本项目。Leaflet 1.9.4 发行文件另依 BSD-2-Clause 许可使用，来源与版权声明见 `frontend/assets/vendor/ASSET_ORIGIN.md` 和 `frontend/assets/vendor/leaflet-LICENSE.txt`。

## 方法与论文

本项目参考 His-Geo 论文提出的历史地名抽取、地理编码和位置不确定性处理思路，并检查其公开实现。感谢论文作者的研究与工具：

> Chen, Yuqi, Wenyi Shang, Hongsu Wang, Sophia Zhang, and Peter K. Bol. 2026. “Geocoding the Past World: Unearthing Coordinates of Early China from Texts Using Generative AI.” *International Journal of Geographical Information Science* 40 (3): 781–807. https://doi.org/10.1080/13658816.2025.2491711.

论文项目介绍：[Centre for Quantitative History](https://www.cqh.hku.hk/research/geocoding-the-past-world-unearthing-coordinates-of-early-china-from-texts-using-generative-ai/)。公开代码：[yukiyuqichen/His-Geo](https://github.com/yukiyuqichen/His-Geo)。本项目是独立应用与实验，不代表论文作者或工具作者认可本项目，也不应将本项目的探索性结果归于论文作者。

## 数据与软件来源

- 中国现代省、市、县行政边界由项目用户本地提供，审图号、坐标系、文件哈希与处理方式见 `docs/BASEMAP.md`；上传前应确认发布渠道与再分发条件。
- Natural Earth 底图数据来源、版本与许可见 `docs/BASEMAP.md`。
- 本项目没有声明一项覆盖全部内容的统一许可证。小说转录文本、行政边界、地名志、软件库分别受各自来源和许可约束；请勿将本文件理解为第三方素材许可。
