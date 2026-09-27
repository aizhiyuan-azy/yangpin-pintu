/**
 * 标注编辑器：在原图像素坐标里记文字 / 箭头 / 圆圈，
 * 屏幕上只是预览；保存时按原分辨率一次性画上去，避免越改越糊。
 */
(function (global) {
    const CONFIG = global.APP_CONFIG;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {HTMLImageElement} image
     */
    function createEditor(canvas, image) {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("当前浏览器无法打开标注画板");
        }

        /** @type {Array<Object>} */
        let marks = [];
        let tool = "text";
        let color = CONFIG.DEFAULT_COLOR;
        let drawing = null;
        let view = { scale: 1, offsetX: 0, offsetY: 0 };

        /**
         * 按屏幕大小适配画布，但逻辑坐标始终是原图像素。
         */
        function fitCanvas() {
            const wrap = canvas.parentElement;
            const maxW = (wrap && wrap.clientWidth) || window.innerWidth;
            const maxH = Math.max(240, window.innerHeight * 0.58);
            const scale = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
            view.scale = scale;
            canvas.width = Math.round(image.naturalWidth * scale);
            canvas.height = Math.round(image.naturalHeight * scale);
            canvas.style.width = canvas.width + "px";
            canvas.style.height = canvas.height + "px";
            redraw();
        }

        /**
         * 屏幕点 -> 原图像素。
         * @param {number} clientX
         * @param {number} clientY
         */
        function toImagePoint(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const x = (clientX - rect.left) * (image.naturalWidth / rect.width);
            const y = (clientY - rect.top) * (image.naturalHeight / rect.height);
            return {
                x: Math.max(0, Math.min(image.naturalWidth, x)),
                y: Math.max(0, Math.min(image.naturalHeight, y)),
            };
        }

        /**
         * 画一条带箭头的线。
         */
        function drawArrow(targetCtx, mark, scale) {
            const x1 = mark.x1 * scale;
            const y1 = mark.y1 * scale;
            const x2 = mark.x2 * scale;
            const y2 = mark.y2 * scale;
            const lineW = Math.max(2, mark.lineWidth * scale);
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const head = Math.max(12, lineW * 5);

            targetCtx.strokeStyle = mark.color;
            targetCtx.fillStyle = mark.color;
            targetCtx.lineWidth = lineW;
            targetCtx.lineCap = "round";
            targetCtx.beginPath();
            targetCtx.moveTo(x1, y1);
            targetCtx.lineTo(x2, y2);
            targetCtx.stroke();

            targetCtx.beginPath();
            targetCtx.moveTo(x2, y2);
            targetCtx.lineTo(
                x2 - head * Math.cos(angle - Math.PI / 6),
                y2 - head * Math.sin(angle - Math.PI / 6)
            );
            targetCtx.lineTo(
                x2 - head * Math.cos(angle + Math.PI / 6),
                y2 - head * Math.sin(angle + Math.PI / 6)
            );
            targetCtx.closePath();
            targetCtx.fill();
        }

        /**
         * 把一条标注画到任意 ctx（预览或导出）。
         */
        function paintMark(targetCtx, mark, scale) {
            targetCtx.save();
            if (mark.type === "text") {
                const fontSize = Math.max(18, mark.fontSize * scale);
                targetCtx.font =
                    "600 " + fontSize + 'px "PingFang SC","Microsoft YaHei",sans-serif';
                targetCtx.textBaseline = "middle";
                targetCtx.lineJoin = "round";
                targetCtx.lineWidth = Math.max(2, fontSize * 0.08);
                targetCtx.strokeStyle = "rgba(0,0,0,0.55)";
                targetCtx.fillStyle = mark.color;
                const tx = mark.x * scale;
                const ty = mark.y * scale;
                targetCtx.strokeText(mark.text, tx, ty);
                targetCtx.fillText(mark.text, tx, ty);
            } else if (mark.type === "arrow") {
                drawArrow(targetCtx, mark, scale);
            } else if (mark.type === "circle") {
                targetCtx.strokeStyle = mark.color;
                targetCtx.lineWidth = Math.max(2, mark.lineWidth * scale);
                targetCtx.beginPath();
                targetCtx.ellipse(
                    mark.cx * scale,
                    mark.cy * scale,
                    Math.max(4, mark.rx * scale),
                    Math.max(4, mark.ry * scale),
                    0,
                    0,
                    Math.PI * 2
                );
                targetCtx.stroke();
            }
            targetCtx.restore();
        }

        /**
         * 重绘预览（屏幕分辨率即可，手指操作要流畅）。
         */
        function redraw() {
            const scale = canvas.width / image.naturalWidth;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            marks.forEach(function (mark) {
                paintMark(ctx, mark, scale);
            });
            if (drawing) {
                paintMark(ctx, drawing, scale);
            }
        }

        /**
         * 默认字号、线宽随原图走，大图不会显得字太小。
         */
        function defaultFontSize() {
            return image.naturalWidth * CONFIG.TEXT_SIZE_RATIO;
        }

        function defaultLineWidth() {
            return Math.max(3, image.naturalWidth * CONFIG.LINE_WIDTH_RATIO);
        }

        function hasTextMark() {
            for (let i = 0; i < marks.length; i += 1) {
                if (marks[i].type === "text") {
                    return true;
                }
            }
            return false;
        }

        /**
         * 写了型号但没点照片时，自动贴到画面上方，少点一次。
         * @param {string} text
         * @returns {boolean}
         */
        function ensureSampleText(text) {
            if (hasTextMark()) {
                return true;
            }
            return addText(text, {
                x: image.naturalWidth * 0.16,
                y: image.naturalHeight * 0.3,
            });
        }

        function addText(text, point) {
            const value = (text || "").trim();
            if (!value) {
                return false;
            }
            marks.push({
                type: "text",
                x: point.x,
                y: point.y,
                text: value,
                color: color,
                fontSize: defaultFontSize(),
            });
            redraw();
            notifyMarksChanged();
            return true;
        }

        function setTool(nextTool) {
            tool = nextTool;
        }

        function setColor(nextColor) {
            color = nextColor;
        }

        function undo() {
            if (drawing) {
                drawing = null;
            } else {
                marks.pop();
            }
            redraw();
            notifyMarksChanged();
        }

        /**
         * 标注有变动，外面立刻把图存进本地库，不用等点「完成」。
         */
        function notifyMarksChanged() {
            canvas.dispatchEvent(new CustomEvent("marks-changed"));
        }

        /**
         * 按原图像素导出，文字和圈都会跟着原图放大，不二次压缩预览图。
         * @returns {string}
         */
        function exportDataUrl() {
            const out = document.createElement("canvas");
            out.width = image.naturalWidth;
            out.height = image.naturalHeight;
            const outCtx = out.getContext("2d");
            if (!outCtx) {
                throw new Error("导出画布失败");
            }
            // 1:1 贴原图，关闭平滑，避免导出时被二次模糊
            outCtx.imageSmoothingEnabled = false;
            outCtx.drawImage(image, 0, 0);
            marks.forEach(function (mark) {
                paintMark(outCtx, mark, 1);
            });
            return out.toDataURL("image/jpeg", CONFIG.JPEG_QUALITY);
        }

        function onPointerDown(event) {
            event.preventDefault();
            const point = toImagePoint(event.clientX, event.clientY);
            if (tool === "text") {
                canvas.dispatchEvent(
                    new CustomEvent("place-text", { detail: point })
                );
                return;
            }
            if (tool === "arrow") {
                drawing = {
                    type: "arrow",
                    x1: point.x,
                    y1: point.y,
                    x2: point.x,
                    y2: point.y,
                    color: color,
                    lineWidth: defaultLineWidth(),
                };
            } else if (tool === "circle") {
                drawing = {
                    type: "circle",
                    cx: point.x,
                    cy: point.y,
                    rx: 4,
                    ry: 4,
                    color: color,
                    lineWidth: defaultLineWidth(),
                    startX: point.x,
                    startY: point.y,
                };
            }
        }

        function onPointerMove(event) {
            if (!drawing) {
                return;
            }
            event.preventDefault();
            const point = toImagePoint(event.clientX, event.clientY);
            if (drawing.type === "arrow") {
                drawing.x2 = point.x;
                drawing.y2 = point.y;
            } else if (drawing.type === "circle") {
                drawing.rx = Math.abs(point.x - drawing.startX);
                drawing.ry = Math.abs(point.y - drawing.startY);
                drawing.cx = (point.x + drawing.startX) / 2;
                drawing.cy = (point.y + drawing.startY) / 2;
            }
            redraw();
        }

        function onPointerUp(event) {
            if (!drawing) {
                return;
            }
            event.preventDefault();
            marks.push(drawing);
            drawing = null;
            redraw();
            notifyMarksChanged();
        }

        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        window.addEventListener("resize", fitCanvas);
        fitCanvas();

        /**
         * 关掉本张编辑，避免下一张还叠着旧的触摸事件。
         */
        function destroy() {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerUp);
            window.removeEventListener("resize", fitCanvas);
        }

        return {
            setTool: setTool,
            setColor: setColor,
            addText: addText,
            ensureSampleText: ensureSampleText,
            hasTextMark: hasTextMark,
            undo: undo,
            exportDataUrl: exportDataUrl,
            fitCanvas: fitCanvas,
            destroy: destroy,
            getTool: function () {
                return tool;
            },
        };
    }

    /**
     * 按最长边算出缩小后的宽高。不超过上限就不缩。
     * @param {number} width
     * @param {number} height
     * @param {number} maxEdge
     * @returns {{width: number, height: number, scale: number}}
     */
    function fitWithinMaxEdge(width, height, maxEdge) {
        const w = Math.max(1, width || 0);
        const h = Math.max(1, height || 0);
        const cap = Math.max(1, maxEdge || 1280);
        const longSide = Math.max(w, h);
        if (longSide <= cap) {
            return { width: w, height: h, scale: 1 };
        }
        const scale = cap / longSide;
        return {
            width: Math.max(1, Math.round(w * scale)),
            height: Math.max(1, Math.round(h * scale)),
            scale: scale,
        };
    }

    /**
     * 把画布压成 JPEG，再读回 Image。失败时把原因抛出去。
     * @param {HTMLCanvasElement} canvas
     * @param {number} quality
     * @returns {Promise<HTMLImageElement>}
     */
    function canvasToJpegImage(canvas, quality) {
        const q = typeof quality === "number" ? quality : CONFIG.JPEG_QUALITY;
        return new Promise(function (resolve, reject) {
            if (canvas.toBlob) {
                canvas.toBlob(
                    function (blob) {
                        if (!blob) {
                            reject(new Error("压缩照片失败"));
                            return;
                        }
                        loadByObjectUrl(blob).then(resolve).catch(reject);
                    },
                    "image/jpeg",
                    q
                );
                return;
            }
            try {
                const dataUrl = canvas.toDataURL("image/jpeg", q);
                if (!dataUrl || dataUrl.length < 100) {
                    reject(new Error("压缩照片失败"));
                    return;
                }
                const image = new Image();
                image.onload = function () {
                    if (!image.naturalWidth) {
                        reject(new Error("压缩后的照片是空的"));
                        return;
                    }
                    resolve(image);
                };
                image.onerror = function () {
                    reject(new Error("压缩后的照片打不开"));
                };
                image.src = dataUrl;
            } catch (err) {
                reject(err || new Error("压缩照片失败"));
            }
        });
    }

    /**
     * 单张图超过最长边就缩小，并按配置质量重压 JPEG。
     * 原图解码逻辑还在，这一步只是读入后立刻降内存。
     * @param {HTMLImageElement} image
     * @returns {Promise<HTMLImageElement>}
     */
    function shrinkImageIfNeeded(image) {
        if (!image || !image.naturalWidth || !image.naturalHeight) {
            return Promise.reject(new Error("照片读出来是空的，请重拍"));
        }
        const fit = fitWithinMaxEdge(
            image.naturalWidth,
            image.naturalHeight,
            CONFIG.PHOTO_MAX_EDGE
        );
        const canvas = document.createElement("canvas");
        canvas.width = fit.width;
        canvas.height = fit.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return Promise.resolve(image);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, fit.width, fit.height);
        return canvasToJpegImage(canvas, CONFIG.JPEG_QUALITY).catch(function () {
            // 压缩失败不打断拍照，继续用已解码的图
            return image;
        });
    }

    /**
     * 用原文件直接解码成 Image（不再压一遍）。
     * @param {File} file
     * @returns {Promise<HTMLImageElement>}
     */
    function loadByObjectUrl(file) {
        return new Promise(function (resolve, reject) {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = function () {
                URL.revokeObjectURL(url);
                if (!image.naturalWidth) {
                    reject(new Error("照片读出来是空的，请重拍"));
                    return;
                }
                resolve(image);
            };
            image.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error("这张照片打不开，请换一张"));
            };
            image.src = url;
        });
    }

    /**
     * 少数浏览器会把 Image 缩得很小；用 Bitmap 兜底。
     * 画到画布时就按最长边缩小，避免先建一张超大原图像素。
     * @param {ImageBitmap} bitmap
     * @returns {Promise<HTMLImageElement>}
     */
    function imageFromBitmap(bitmap) {
        const fit = fitWithinMaxEdge(
            bitmap.width,
            bitmap.height,
            CONFIG.PHOTO_MAX_EDGE
        );
        const canvas = document.createElement("canvas");
        canvas.width = fit.width;
        canvas.height = fit.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            bitmap.close();
            return Promise.reject(new Error("无法按原像素解码"));
        }
        // 需要缩小时才开平滑；1:1 仍关闭，避免无谓模糊
        ctx.imageSmoothingEnabled = fit.scale < 1;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
        bitmap.close();
        return canvasToJpegImage(canvas, CONFIG.JPEG_QUALITY).catch(function () {
            return Promise.reject(new Error("原像素转存失败"));
        });
    }

    /**
     * 把文件读成 Image。先按原来的方式解码（必要时用 Bitmap 纠正方向），
     * 最后再缩到 PHOTO_MAX_EDGE，降低单张占用的内存。
     * @param {File} file
     * @returns {Promise<HTMLImageElement>}
     */
    function loadFileAsImage(file) {
        if (!file) {
            return Promise.reject(new Error("没有选到照片"));
        }
        return loadByObjectUrl(file)
            .then(function (image) {
                if (!window.createImageBitmap) {
                    return image;
                }
                return createImageBitmap(file, { imageOrientation: "from-image" })
                    .then(function (bitmap) {
                        const bigger =
                            bitmap.width > image.naturalWidth ||
                            bitmap.height > image.naturalHeight;
                        if (bigger) {
                            return imageFromBitmap(bitmap);
                        }
                        bitmap.close();
                        return image;
                    })
                    .catch(function () {
                        return image;
                    });
            })
            .then(shrinkImageIfNeeded);
    }

    global.PhotoEditor = {
        createEditor: createEditor,
        loadFileAsImage: loadFileAsImage,
    };
})(window);
