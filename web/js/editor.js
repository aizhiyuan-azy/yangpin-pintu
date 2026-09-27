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

        /**
         * 贴上型号文字。点画布时调用。
         * @param {string} text
         * @param {{x:number,y:number}} point
         */
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
     * 少数浏览器会把 Image 缩得很小；用相机原像素的 Bitmap 兜底。
     * @param {ImageBitmap} bitmap
     * @returns {Promise<HTMLImageElement>}
     */
    function imageFromBitmap(bitmap) {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            bitmap.close();
            return Promise.reject(new Error("无法按原像素解码"));
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return new Promise(function (resolve, reject) {
            canvas.toBlob(
                function (blob) {
                    if (!blob) {
                        reject(new Error("原像素转存失败"));
                        return;
                    }
                    loadByObjectUrl(blob).then(resolve).catch(reject);
                },
                "image/jpeg",
                CONFIG.JPEG_QUALITY
            );
        });
    }

    /**
     * 把文件读成 Image，尽量保留系统相机原分辨率。
     * @param {File} file
     * @returns {Promise<HTMLImageElement>}
     */
    function loadFileAsImage(file) {
        if (!file) {
            return Promise.reject(new Error("没有选到照片"));
        }
        return loadByObjectUrl(file).then(function (image) {
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
        });
    }

    global.PhotoEditor = {
        createEditor: createEditor,
        loadFileAsImage: loadFileAsImage,
    };
})(window);
