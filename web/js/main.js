/**
 * 车间主流程：拍照 → 当场标注 → 存相册/缓存 → 满 9 张自动拼，也可提前拼。
 */
(function () {
    const CONFIG = window.APP_CONFIG;
    const $ = function (id) {
        return document.getElementById(id);
    };

    const els = {
        wechatBar: $("wechatBar"),
        iosBar: $("iosBar"),
        chromeBar: $("chromeBar"),
        statusText: $("statusText"),
        logBox: $("logBox"),
        homeView: $("homeView"),
        editorView: $("editorView"),
        collageView: $("collageView"),
        thumbList: $("thumbList"),
        btnEarlyCollage: $("btnEarlyCollage"),
        btnClear: $("btnClear"),
        fileShot: $("fileShot"),
        fileAlbum: $("fileAlbum"),
        editorCanvas: $("editorCanvas"),
        textInput: $("textInput"),
        toolText: $("toolText"),
        toolArrow: $("toolArrow"),
        toolCircle: $("toolCircle"),
        btnUndo: $("btnUndo"),
        btnCancelEdit: $("btnCancelEdit"),
        btnSaveEdit: $("btnSaveEdit"),
        colorRow: $("colorRow"),
        collagePreview: $("collagePreview"),
        btnSaveCollage: $("btnSaveCollage"),
        btnBackHome: $("btnBackHome"),
        saveSheet: $("saveSheet"),
        saveSheetHint: $("saveSheetHint"),
        saveSheetImg: $("saveSheetImg"),
        btnCloseSheet: $("btnCloseSheet"),
    };

    /** 当前正在标的原图 */
    let editor = null;
    let editorImage = null;
    /** 刚拼好、等待保存的拼图 */
    let pendingCollageUrl = "";
    let currentBatchId = window.PhotoStorage.makeBatchId();
    /** 相册多选后排队，一张张打开标注，不改原来的单张编辑逻辑 */
    let importQueue = [];

    /**
     * 弹出刚导出的图，方便长按存进相册（苹果 HTTP 下尤其需要）。
     * @param {string} dataUrl
     */
    function showSaveSheet(dataUrl) {
        els.saveSheetImg.src = dataUrl;
        els.saveSheetHint.textContent = window.PhotoSave.saveHint();
        els.saveSheet.hidden = false;
    }

    function logLine(message) {
        const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        const line = document.createElement("div");
        line.textContent = time + "  " + message;
        els.logBox.appendChild(line);
        els.logBox.scrollTop = els.logBox.scrollHeight;
    }

    /**
     * 切视图：首页 / 标注 / 拼图预览。
     * @param {"home"|"editor"|"collage"} name
     */
    function showView(name) {
        els.homeView.hidden = name !== "home";
        els.editorView.hidden = name !== "editor";
        els.collageView.hidden = name !== "collage";
    }

    function setToolActive(toolName) {
        [els.toolText, els.toolArrow, els.toolCircle].forEach(function (btn) {
            btn.classList.toggle("is-active", btn.dataset.tool === toolName);
        });
        if (editor) {
            editor.setTool(toolName);
        }
        els.textInput.parentElement.classList.toggle("is-disabled", toolName !== "text");
    }

    /**
     * 刷新首页：张数、缩略图、按钮状态。
     */
    function refreshHome() {
        return window.PhotoStorage.listPhotos().then(function (photos) {
            const batchPhotos = photos.filter(function (item) {
                return item.batchId === currentBatchId && !item.isCollage;
            });
            const n = batchPhotos.length;
            els.statusText.textContent =
                "本批 " + n + " / " + CONFIG.BATCH_SIZE + " 张（批次 " + currentBatchId + "）";
            els.btnEarlyCollage.disabled = n < 1;
            els.thumbList.innerHTML = "";

            batchPhotos.forEach(function (photo) {
                const card = document.createElement("div");
                card.className = "thumb-card";
                const img = document.createElement("img");
                img.src = photo.dataUrl;
                img.alt = photo.sampleId || "样品图";
                const cap = document.createElement("div");
                cap.className = "thumb-cap";
                cap.textContent = photo.sampleId || "未写型号";
                const del = document.createElement("button");
                del.type = "button";
                del.className = "thumb-del";
                del.textContent = "删";
                del.addEventListener("click", function () {
                    window.PhotoStorage.deletePhoto(photo.id)
                        .then(function () {
                            logLine("已删除一张细节图");
                            return refreshHome();
                        })
                        .catch(function (err) {
                            logLine("删除失败：" + err.message);
                        });
                });
                card.appendChild(img);
                card.appendChild(cap);
                card.appendChild(del);
                els.thumbList.appendChild(card);
            });
            return batchPhotos;
        });
    }

    /**
     * 打开标注页。拍照和相册导入走同一条路，保证画质处理一致。
     * @param {File} file
     */
    function openEditorWithFile(file) {
        window.PhotoEditor.loadFileAsImage(file)
            .then(function (image) {
                if (editor && editor.destroy) {
                    editor.destroy();
                }
                editorImage = image;
                editor = window.PhotoEditor.createEditor(els.editorCanvas, image);
                // 同型号连拍时保留上次文字，避免反复输入
                els.textInput.focus();
                setToolActive("text");
                showView("editor");
                const mega = (
                    (image.naturalWidth * image.naturalHeight) /
                    1000000
                ).toFixed(1);
                logLine(
                    "已打开原图 " +
                        image.naturalWidth +
                        "×" +
                        image.naturalHeight +
                        "（" +
                        mega +
                        "MP），请立刻写型号"
                );
            })
            .catch(function (err) {
                logLine("打开照片失败：" + err.message);
                openNextQueuedFile();
            });
    }

    /**
     * 把相册一次选出的多张放进队列。
     * @param {FileList|File[]} fileList
     */
    function enqueueAlbumFiles(fileList) {
        if (!fileList || !fileList.length) {
            return;
        }
        for (let i = 0; i < fileList.length; i += 1) {
            const item = fileList[i];
            if (item && item.type && item.type.indexOf("image/") === 0) {
                importQueue.push(item);
            } else if (item && !item.type) {
                // 少数浏览器不带 type，按图片试开
                importQueue.push(item);
            }
        }
        if (!importQueue.length) {
            logLine("没有选到图片");
            return;
        }
        logLine("已选 " + importQueue.length + " 张，将一张张标注");
        openNextQueuedFile();
    }

    /**
     * 取出队列下一张，沿用原来的单张标注。
     */
    function openNextQueuedFile() {
        if (!importQueue.length) {
            return;
        }
        if (pendingCollageUrl) {
            logLine("请先保存当前拼图，再继续标剩下的 " + importQueue.length + " 张");
            return;
        }
        const next = importQueue.shift();
        const left = importQueue.length;
        if (left) {
            logLine("还剩 " + left + " 张待标注");
        }
        openEditorWithFile(next);
    }

    /**
     * 当前这批未拼过的细节图。
     * @returns {Promise<Array>}
     */
    function getCurrentBatchPhotos() {
        return window.PhotoStorage.listPhotos().then(function (photos) {
            return photos.filter(function (item) {
                return item.batchId === currentBatchId && !item.isCollage;
            });
        });
    }

    /**
     * 生成拼图并进入预览。满 9 张或点「提前拼图」都走这里。
     * @param {boolean} autoTrigger
     */
    function makeCollage(autoTrigger) {
        return getCurrentBatchPhotos().then(function (photos) {
            if (!photos.length) {
                throw new Error("还没有已保存的细节图");
            }
            logLine((autoTrigger ? "已满 " + CONFIG.BATCH_SIZE + " 张，" : "提前") + "开始拼图");
            // 一页最多 9 张；多出来的等下一批，避免挤出画布
            const page = photos.slice(0, CONFIG.BATCH_SIZE);
            const urls = page.map(function (item) {
                return item.dataUrl;
            });
            return window.PhotoCollage.buildCollage(urls).then(function (dataUrl) {
                pendingCollageUrl = dataUrl;
                els.collagePreview.src = dataUrl;
                showView("collage");
                logLine("拼图已生成，请再点一次「保存拼图到相册」");
            });
        });
    }

    /**
     * 保存标注图：缓存 + 调起手机保存/分享。
     */
    function saveEditedPhoto() {
        if (!editor) {
            logLine("没有正在编辑的照片");
            return;
        }
        const sampleId = (els.textInput.value || "").trim();
        let dataUrl;
        try {
            dataUrl = editor.exportDataUrl();
        } catch (err) {
            logLine("导出失败：" + err.message);
            return;
        }

        const photo = {
            id: "p-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8),
            batchId: currentBatchId,
            sampleId: sampleId,
            dataUrl: dataUrl,
            createdAt: Date.now(),
            isCollage: false,
        };

        const filename =
            (sampleId || "sample") +
            "_" +
            currentBatchId +
            "_" +
            String(Date.now()).slice(-6) +
            ".jpg";

        els.btnSaveEdit.disabled = true;
        window.PhotoStorage.savePhoto(photo)
            .then(function () {
                return window.PhotoSave.saveImageToPhone(dataUrl, filename);
            })
            .then(function () {
                logLine("细节图已保存" + (sampleId ? "（" + sampleId + "）" : ""));
                if (editor && editor.destroy) {
                    editor.destroy();
                }
                editor = null;
                editorImage = null;
                showView("home");
                // 队列里还有图时先不挡长按保存层，避免打断连标
                if (!importQueue.length) {
                    showSaveSheet(dataUrl);
                }
                return refreshHome();
            })
            .then(function (batchPhotos) {
                if (batchPhotos.length >= CONFIG.BATCH_SIZE) {
                    return makeCollage(true);
                }
                openNextQueuedFile();
                return null;
            })
            .catch(function (err) {
                logLine("保存失败：" + err.message);
            })
            .then(function () {
                els.btnSaveEdit.disabled = false;
            });
    }

    /**
     * 保存拼图后，开启新批次，细节图仍留在缓存里可回看缩略图所在批次。
     */
    function saveCollageAndRotateBatch() {
        if (!pendingCollageUrl) {
            logLine("没有待保存的拼图");
            return;
        }
        const filename = "collage_" + currentBatchId + ".jpg";
        const record = {
            id: "c-" + Date.now(),
            batchId: currentBatchId,
            sampleId: "拼图",
            dataUrl: pendingCollageUrl,
            createdAt: Date.now(),
            isCollage: true,
        };

        els.btnSaveCollage.disabled = true;
        window.PhotoStorage.savePhoto(record)
            .then(function () {
                return window.PhotoSave.saveImageToPhone(pendingCollageUrl, filename);
            })
            .then(function () {
                logLine("拼图已保存，开始下一批");
                showSaveSheet(pendingCollageUrl);
                pendingCollageUrl = "";
                currentBatchId = window.PhotoStorage.makeBatchId();
                showView("home");
                return refreshHome();
            })
            .then(function () {
                openNextQueuedFile();
            })
            .catch(function (err) {
                logLine("拼图保存失败：" + err.message);
            })
            .then(function () {
                els.btnSaveCollage.disabled = false;
            });
    }

    function bindEvents() {
        els.fileShot.addEventListener("change", function () {
            const file = els.fileShot.files && els.fileShot.files[0];
            els.fileShot.value = "";
            if (file) {
                openEditorWithFile(file);
            }
        });
        els.fileAlbum.addEventListener("change", function () {
            const picked = els.fileAlbum.files;
            enqueueAlbumFiles(picked);
            els.fileAlbum.value = "";
        });

        els.toolText.addEventListener("click", function () {
            setToolActive("text");
        });
        els.toolArrow.addEventListener("click", function () {
            setToolActive("arrow");
        });
        els.toolCircle.addEventListener("click", function () {
            setToolActive("circle");
        });
        els.btnUndo.addEventListener("click", function () {
            if (editor) {
                editor.undo();
            }
        });
        els.btnCancelEdit.addEventListener("click", function () {
            if (editor && editor.destroy) {
                editor.destroy();
            }
            editor = null;
            editorImage = null;
            showView("home");
            logLine("已跳过这张，未保存");
            openNextQueuedFile();
        });
        els.btnSaveEdit.addEventListener("click", saveEditedPhoto);

        els.editorCanvas.addEventListener("place-text", function (event) {
            if (!editor) {
                return;
            }
            const ok = editor.addText(els.textInput.value, event.detail);
            if (!ok) {
                logLine("请先在上方输入型号，再点照片贴上去");
                els.textInput.focus();
            }
        });

        els.colorRow.addEventListener("click", function (event) {
            const btn = event.target.closest("[data-color]");
            if (!btn) {
                return;
            }
            const color = btn.getAttribute("data-color");
            Array.prototype.forEach.call(els.colorRow.children, function (item) {
                item.classList.toggle("is-active", item === btn);
            });
            if (editor) {
                editor.setColor(color);
            }
        });

        els.btnEarlyCollage.addEventListener("click", function () {
            makeCollage(false).catch(function (err) {
                logLine("拼图失败：" + err.message);
            });
        });
        els.btnSaveCollage.addEventListener("click", saveCollageAndRotateBatch);
        els.btnBackHome.addEventListener("click", function () {
            pendingCollageUrl = "";
            showView("home");
            openNextQueuedFile();
        });
        els.btnCloseSheet.addEventListener("click", function () {
            els.saveSheet.hidden = true;
            els.saveSheetImg.src = "";
        });
        els.btnClear.addEventListener("click", function () {
            if (!window.confirm("清空本机缓存的全部细节图和拼图？相册里已保存的不会删。")) {
                return;
            }
            window.PhotoStorage.clearAll()
                .then(function () {
                    currentBatchId = window.PhotoStorage.makeBatchId();
                    logLine("缓存已清空");
                    return refreshHome();
                })
                .catch(function (err) {
                    logLine("清空失败：" + err.message);
                });
        });
    }

    function isHomeScreen() {
        return (
            window.navigator.standalone === true ||
            window.matchMedia("(display-mode: standalone)").matches
        );
    }

    function boot() {
        if (window.PhotoSave.isWeChat()) {
            els.wechatBar.hidden = false;
        }
        if (els.chromeBar && window.PhotoSave.isChrome()) {
            els.chromeBar.hidden = false;
        }
        if (els.iosBar && window.PhotoSave.isIOS() && !isHomeScreen()) {
            els.iosBar.hidden = false;
        }
        bindEvents();
        setToolActive("text");
        showView("home");
        refreshHome()
            .then(function () {
                if (window.PhotoSave.isIOS()) {
                    logLine("苹果请用 Safari。点拍照会调系统相机，长按图片可存相册");
                } else {
                    logLine("安卓请用百度浏览器。点拍照会调系统相机，发微信请勾选原图");
                }
            })
            .catch(function (err) {
                logLine("初始化失败：" + err.message);
            });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
