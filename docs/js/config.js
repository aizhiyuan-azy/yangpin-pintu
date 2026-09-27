/**
 * 车间拍照拼图：全局配置
 * 改这里即可调整画质、批次、颜色，不必翻业务代码。
 */
window.APP_CONFIG = {
    /** 满几张自动拼一张 3×3 */
    BATCH_SIZE: 9,

    /** 单张导出 JPEG 质量，0~1。0.98 接近原相机，再高文件很大、肉眼差不多 */
    JPEG_QUALITY: 0.98,

    /**
     * 拼图每格最长边上限。优先用原图像素，内存不够再自动降。
     * 细节图始终按相机原分辨率保存，不受这个值影响。
     */
    COLLAGE_CELL_MAX: 4096,

    /** 拼图格子缝隙（像素） */
    COLLAGE_GAP: 16,

    /** 拼图空白格 / 背景色 */
    COLLAGE_BG: "#111111",

    /** 标注默认颜色（和现场红笔圈缺陷一致） */
    DEFAULT_COLOR: "#e53935",

    /** 文字相对原图宽度的比例 */
    TEXT_SIZE_RATIO: 0.048,

    /** 线条相对原图宽度的比例 */
    LINE_WIDTH_RATIO: 0.0045,

    /** IndexedDB 库名 */
    DB_NAME: "wafer-photo-collage",
    DB_VERSION: 1,
};
