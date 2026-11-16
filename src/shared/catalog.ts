import type { Artwork, Route } from "./types";
export const artworks: Artwork[] = [
  {
    id: "a1",
    title: "山的另一种记忆",
    en: "MEMORY OF THE MOUNTAIN",
    artist: "林知远",
    year: "2025",
    medium: "生成艺术 / 数字微喷",
    color: "#a7c4ac",
    position: { x: -5.4, z: -4 },
    facing: Math.PI / 2,
    description:
      "山并非静止的风景，而是时间缓慢折叠后的形状。艺术家将地形数据转译成层叠的色域，让记忆在虚实之间生长。",
    transcript: [
      "请在这幅作品前稍作停留。层层叠叠的山脊，来自艺术家对故乡的记忆。",
      "画面中的每一条曲线，都是数据与情感的一次相遇。",
      "当你移动视线，山的轮廓也会在想象中重新组合。",
    ],
    duration: 42,
  },
  {
    id: "a2",
    title: "无声的潮汐",
    en: "A SILENT TIDE",
    artist: "陈以宁",
    year: "2024",
    medium: "算法绘画 / 光场",
    color: "#b9b6d6",
    position: { x: 0, z: -7.4 },
    facing: 0,
    description:
      "海浪被拆解为无数细小的光线，涨落不再有声音，只留下颜色的呼吸。这是一段关于消逝与重返的观察。",
    transcript: [
      "这里的海没有声音。",
      "艺术家捕捉了潮水退去后留下的纹理，将它们化成紫色的光。",
      "不妨想象，下一次潮汐到来之前，时间是什么形状。",
    ],
    duration: 36,
  },
  {
    id: "a3",
    title: "日光的切片",
    en: "FRAGMENTS OF LIGHT",
    artist: "周弥",
    year: "2025",
    medium: "数字构成 / 色彩研究",
    color: "#e1a474",
    position: { x: 5.4, z: -4 },
    facing: -Math.PI / 2,
    description:
      "午后的光被截取、平移、重新排列。几何之间的空白，让日常的温度成为可观看的结构。",
    transcript: [
      "这件作品记录了一整个下午的阳光。",
      "暖色的块面是时间留下的切片，边缘的阴影则标记着移动。",
      "你看到的是光，也可能是自己的某个午后。",
    ],
    duration: 39,
  },
  {
    id: "a4",
    title: "浮游之城",
    en: "A FLOATING CITY",
    artist: "何序",
    year: "2023",
    medium: "程序生成 / 建筑幻想",
    color: "#85b9c1",
    position: { x: -5.4, z: 2.5 },
    facing: Math.PI / 2,
    description:
      "城市被从地表轻轻托起，建筑像群岛一样悬浮。失去重力后，我们如何重新理解彼此的距离？",
    transcript: [
      "欢迎来到一座没有地面的城市。",
      "建筑以不可能的方式相连，像记忆中不断重写的街道。",
      "在这里，距离不再由地图决定。",
    ],
    duration: 45,
  },
  {
    id: "a5",
    title: "夜的生长",
    en: "GROWING IN THE DARK",
    artist: "许眠",
    year: "2024",
    medium: "粒子艺术 / 数字绘画",
    color: "#9ba46a",
    position: { x: 5.4, z: 2.5 },
    facing: -Math.PI / 2,
    description:
      "微小的光点在黑暗中聚集，形成介于植物与星系之间的生命。生长不需要被看见，却一直发生。",
    transcript: [
      "把视线放慢，你会看到黑暗也在生长。",
      "每一个光点都遵循简单的规则，而它们共同形成了复杂的生命。",
      "这是一次关于偶然与秩序的实验。",
    ],
    duration: 33,
  },
  {
    id: "a6",
    title: "时间的容器",
    en: "VESSELS OF TIME",
    artist: "苏望",
    year: "2025",
    medium: "三维雕塑 / 形态实验",
    color: "#d5c6b4",
    position: { x: 0, z: 5.5 },
    facing: Math.PI,
    description:
      "重复的圆环并不通向同一个终点。虚拟雕塑以不可能的空间关系，邀请你重新感受时间的流向。",
    transcript: [
      "时间能被装进一个容器吗？",
      "这些圆环彼此穿过，却始终保留独立的方向。",
      "绕行，停留，或者回望，都可以成为你理解这件作品的方式。",
    ],
    duration: 48,
  },
];
export const routes: Route[] = [
  {
    id: "nature",
    name: "自然的回响",
    subtitle: "在山海与微光之间，寻找自然的另一种表达",
    stops: ["a1", "a2", "a5"],
  },
  {
    id: "space",
    name: "空间的诗学",
    subtitle: "穿行于光、建筑与时间的边界",
    stops: ["a3", "a4", "a6"],
  },
];
export const artworkById = (id: string | null) =>
  artworks.find((a) => a.id === id);
