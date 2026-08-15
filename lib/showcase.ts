export type ShowcaseCategory = "产品广告" | "人物种草" | "场景视觉";

export type ShowcaseItem = {
  id: string;
  title: string;
  category: ShowcaseCategory;
  description: string;
  duration: string;
  aspectRatio: "9:16" | "16:9";
  posterUrl: string;
  videoUrl: string;
};

const assetRoot = "https://video.cauai.fun";

export const showcaseItems: ShowcaseItem[] = [
  { id: "case-01", title: "航拍风景质感片", category: "场景视觉", description: "适合文旅、城市、酒店和景区的空间氛围表达。", duration: "14.3 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_01.webp?v=13`, videoUrl: `${assetRoot}/videos/case_01.mp4` },
  { id: "case-02", title: "工具产品广告 01", category: "产品广告", description: "真人出镜感与产品使用场景结合，突出核心功能。", duration: "28 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_02.webp?v=13`, videoUrl: `${assetRoot}/videos/case_02.mp4` },
  { id: "case-05", title: "工具产品广告 02", category: "产品广告", description: "以痛点切入产品展示，适合短视频广告素材。", duration: "16.3 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_05.webp?v=13`, videoUrl: `${assetRoot}/videos/case_05.mp4` },
  { id: "case-09", title: "工具产品广告 03", category: "产品广告", description: "同一产品的差异化开头与卖点表达版本。", duration: "16.3 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_09.webp?v=13`, videoUrl: `${assetRoot}/videos/case_09.mp4` },
  { id: "case-03", title: "露营人物横屏短片", category: "人物种草", description: "生活方式氛围、多镜头延展与横屏品牌表达。", duration: "49.5 秒", aspectRatio: "16:9", posterUrl: `${assetRoot}/assets/case_03.webp?v=13`, videoUrl: `${assetRoot}/videos/case_03.mp4` },
  { id: "case-04", title: "露营人物竖屏短片 01", category: "人物种草", description: "人物稳定与夜景氛围结合的竖屏内容。", duration: "17 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_04.webp?v=13`, videoUrl: `${assetRoot}/videos/case_04.mp4` },
  { id: "case-07", title: "露营人物竖屏短片 02", category: "人物种草", description: "适合服装、露营和生活方式内容的竖屏表达。", duration: "17 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_07.webp?v=13`, videoUrl: `${assetRoot}/videos/case_07.mp4` },
  { id: "case-06", title: "水果视觉广告", category: "场景视觉", description: "面向水果、食品和农产品的横屏视觉广告。", duration: "15.3 秒", aspectRatio: "16:9", posterUrl: `${assetRoot}/assets/case_06.webp?v=13`, videoUrl: `${assetRoot}/videos/case_06.mp4` },
  { id: "case-08", title: "儿童生活方式片", category: "人物种草", description: "自然人物状态与日常场景结合的亲子内容。", duration: "14.1 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_08.webp?v=13`, videoUrl: `${assetRoot}/videos/case_08.mp4` },
  { id: "case-10", title: "童装门店白色套装", category: "人物种草", description: "门店环境、服装展示与人物动作自然结合。", duration: "17 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_10.webp?v=13`, videoUrl: `${assetRoot}/videos/case_10.mp4` },
  { id: "case-11", title: "童装门店薄荷裙装", category: "人物种草", description: "面向换季上新和门店种草的竖屏短片。", duration: "16.9 秒", aspectRatio: "9:16", posterUrl: `${assetRoot}/assets/case_11.webp?v=13`, videoUrl: `${assetRoot}/videos/case_11.mp4` },
];
