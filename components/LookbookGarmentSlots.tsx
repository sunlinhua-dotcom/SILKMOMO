// 后端 productImages 硬上限 8（stream/route.ts）——所有品类主品图合计不得超过此数。
// 1008 清理：原先这里还有按品类分槽的 UI 组件（约 200 行），已无任何引用，整段删除；
// 只保留常量并维持导出路径，app/lookbook/page.tsx 仍从这里 import。
export const MAX_TOTAL_GARMENTS = 8;
