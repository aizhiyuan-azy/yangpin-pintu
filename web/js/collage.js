/**
 * 按张数选「格子尽量大」的布局，再按原图像素拼接。
 * 不足 9 张不硬凑 3×3；超过 9 张由主流程拆成多页。
 */
(function (global) {
    const CONFIG = global.APP_CONFIG;

    /**
     * 根据张数选择行、列，让每张图在拼图里尽量大。
     * @param {number} count
     * @returns {{rows: number, cols: number}}
     */
    function chooseGrid(count) {
        const n = Math.max(1, count);
        if (n === 1) {
            return { rows: 1, cols: 1 };
        }
        if (n === 2) {
            // 手机竖图：上下两张，每张都能用满宽度
            return { rows: 2, cols: 1 };
        }
        if (n === 3 || n === 4) {
            return { rows: 2, cols: 2 };
        }
        if (n === 5 || n === 6) {
            return { rows: 2, cols: 3 };
        }
        return { rows: 3, cols: 3 };
    }

    /**
     * 把 dataURL 读成 Image，失败时给出中文原因。
     * @param {string} dataUrl
     * @returns {Promise<HTMLImageElement>}
     */
    function loadImage(dataUrl) {
        return new Promise(function (resolve, reject) {
            if (!dataUrl) {
                reject(new Error("空图片，无法拼入"));
                return;
            }
            const image = new Image();
            image.onload = function () {
                if (!image.naturalWidth || !image.naturalHeight) {
                    reject(new Error("图片尺寸为 0，已跳过"));
                    return;
                }
                resolve(image);
            };
            image.onerror = function () {
                reject(new Error("图片损坏，无法拼入"));
            };
            image.src = dataUrl;
        });
    }

    /**
     * 读进一张后立刻缩到拼图格子大小，再丢掉原图像素，避免 9 张原图同时占内存。
     * @param {string} dataUrl
     * @param {number} maxEdge
     * @returns {Promise<HTMLImageElement>}
     */
    function loadImageForCell(dataUrl, maxEdge) {
        return loadImage(dataUrl).then(function (image) {
            const longSide = Math.max(image.naturalWidth, image.naturalHeight);
            const scale = longSide > maxEdge ? maxEdge / longSide : 1;
            if (scale >= 0.999) {
                return image;
            }
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                return image;
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            return loadImage(canvas.toDataURL("image/jpeg", CONFIG.JPEG_QUALITY));
        });
    }

    function loadImagesOneByOne(urls) {
        const maxEdge = 1000;
        const loaded = [];
        function next(index) {
            if (index >= urls.length) {
                return Promise.resolve(loaded);
            }
            return loadImageForCell(urls[index], maxEdge)
                .catch(function () {
                    return loadImageForCell(urls[index], 720);
                })
                .then(function (image) {
                    loaded.push(image);
                    return next(index + 1);
                })
                .catch(function (err) {
                    console.warn(err);
                    loaded.push(null);
                    return next(index + 1);
                });
        }
        return next(0);
    }

    function drawContain(ctx, image, x, y, cellW, cellH) {
        const scale = Math.min(cellW / image.naturalWidth, cellH / image.naturalHeight);
        const drawW = image.naturalWidth * scale;
        const drawH = image.naturalHeight * scale;
        const dx = x + (cellW - drawW) / 2;
        const dy = y + (cellH - drawH) / 2;
        ctx.drawImage(image, dx, dy, drawW, drawH);
    }

    /**
     * 把一组已标注图拼成一张，尽量不缩小到看不清缺陷。
     * @param {string[]} dataUrls
     * @param {number} [cellMaxOverride] 可选，内存不够时传入更小的格子上限
     * @returns {Promise<string>} JPEG dataURL
     */
    function buildCollage(dataUrls, cellMaxOverride) {
        const urls = (dataUrls || []).filter(Boolean);
        if (!urls.length) {
            return Promise.reject(new Error("当前没有可拼的照片"));
        }

        return loadImagesOneByOne(urls).then(function (images) {
            const valid = images.filter(Boolean);
            if (!valid.length) {
                throw new Error("照片都读失败，请重新拍");
            }
            if (urls.length > 1 && valid.length < 2) {
                throw new Error(
                    "只读出 " + valid.length + " / " + urls.length + " 张，请再点一次拼图"
                );
            }

            const grid = chooseGrid(valid.length);
            const gap = CONFIG.COLLAGE_GAP;
            const maxEdge = cellMaxOverride || 1000;

            // 格子尺寸取这批图里「较长边」的中位数，再封顶，避免一张超大图把内存打爆
            const longSides = valid.map(function (img) {
                return Math.max(img.naturalWidth, img.naturalHeight);
            });
            longSides.sort(function (a, b) {
                return a - b;
            });
            const median = longSides[Math.floor(longSides.length / 2)];
            const cellLong = Math.min(maxEdge, Math.max(800, median));

            // 用第一张的宽高比当格子比例，整页更整齐
            const first = valid[0];
            const aspect = first.naturalWidth / first.naturalHeight;
            let cellW;
            let cellH;
            if (aspect >= 1) {
                cellW = cellLong;
                cellH = Math.round(cellLong / aspect);
            } else {
                cellH = cellLong;
                cellW = Math.round(cellLong * aspect);
            }

            const canvasW = grid.cols * cellW + (grid.cols + 1) * gap;
            const canvasH = grid.rows * cellH + (grid.rows + 1) * gap;

            const canvas = document.createElement("canvas");
            canvas.width = canvasW;
            canvas.height = canvasH;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                throw new Error("当前浏览器无法绘制拼图");
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.fillStyle = CONFIG.COLLAGE_BG;
            ctx.fillRect(0, 0, canvasW, canvasH);

            valid.forEach(function (image, index) {
                const row = Math.floor(index / grid.cols);
                const col = index % grid.cols;
                const x = gap + col * (cellW + gap);
                const y = gap + row * (cellH + gap);
                ctx.fillStyle = "#000000";
                ctx.fillRect(x, y, cellW, cellH);
                drawContain(ctx, image, x, y, cellW, cellH);
            });

            if (canvas.width !== canvasW || canvas.height !== canvasH) {
                throw new Error("拼图画布被浏览器缩小，改用较低像素重试");
            }

            const dataUrl = canvas.toDataURL("image/jpeg", CONFIG.JPEG_QUALITY);
            if (!dataUrl || dataUrl.length < 100) {
                throw new Error("拼图导出失败，改用较低像素重试");
            }
            return dataUrl;
        });
    }

    /**
     * 先按原图像素拼；内存不够再降低格子。对外仍叫 buildCollage。
     * @param {string[]} dataUrls
     * @returns {Promise<string>}
     */
    function buildCollageSafe(dataUrls) {
        // 先按 1600 拼：原图像素 3×3 会把内存打爆，重试时又只读出 1 张
        const steps = [1000, 800, 640];
        function tryAt(index) {
            return buildCollage(dataUrls, steps[index]).catch(function (err) {
                if (index + 1 < steps.length) {
                    return tryAt(index + 1);
                }
                throw err;
            });
        }
        return tryAt(0);
    }

    /**
     * 把照片列表按 9 张一页切开。
     * @param {Array} photos
     * @param {number} pageSize
     * @returns {Array<Array>}
     */
    function splitPages(photos, pageSize) {
        const size = pageSize || CONFIG.BATCH_SIZE;
        const pages = [];
        for (let i = 0; i < photos.length; i += size) {
            pages.push(photos.slice(i, i + size));
        }
        return pages;
    }

    global.PhotoCollage = {
        chooseGrid: chooseGrid,
        buildCollage: buildCollageSafe,
        splitPages: splitPages,
    };
})(window);
