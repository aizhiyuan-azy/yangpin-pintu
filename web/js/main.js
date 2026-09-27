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
        progressFill: $("progressFill"),
        toast: $("toast"),
        homeView: $("homeView"),
        homeThumbs: $("homeThumbs"),
        editorView: $("editorView"),
        editorCanvasHost: $("editorCanvasHost"),
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
        collageCount: $("collageCount"),
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
    /** 当前这张已写入本地库的 id，标注后覆盖同一张，不另存一份 */
    let currentEditId = "";
    let currentEditCreatedAt = 0;
    /** 刚拼好、等待保存的拼图 */
    let pendingCollageUrl = "";
    /** 拼图时已备好的下载清单，点保存时立刻下，不再等数据库 */
    let pendingSavePack = [];
    /** 拼图对应的单图 id，保存成功后再从缓存删掉 */
    let pendingSingleIds = [];
    let currentBatchId = "";
    /** 相册多选后排队，一张张打开标注，不改原来的单张编辑逻辑 */
    let importQueue = [];
    /** 当前这张是否来自相册。相册图已在手机里，完成时不再下载/分享 */
    let currentFromAlbum = false;

    /**
     * 弹出刚导出的图，方便长按存进相册（苹果 HTTP 下尤其需要）。
     * @param {string} dataUrl
     */
    function showSaveSheet(dataUrl) {
        if (!els.saveSheet) {
            return;
        }
        els.saveSheetImg.src = dataUrl;
        els.saveSheetHint.textContent = window.PhotoSave.saveHint();
        els.saveSheet.hidden = false;
    }

    /**
     * 底部短提示。hold 为 true 时不自动消失，给「正在拼图」这种耗时操作用。
     * @param {string} message
     * @param {boolean} [hold]
     */
    function showToast(message, hold) {
        if (!els.toast) {
            return;
        }
        els.toast.textContent = message;
        els.toast.hidden = false;
        clearTimeout(showToast.timer);
        if (!hold) {
            showToast.timer = setTimeout(function () {
                els.toast.hidden = true;
            }, 2200);
        }
    }

    /**
     * 先让「正在拼图」画出来，再开始算大图，避免页面冻住时提示出不来。
     * @returns {Promise<void>}
     */
    function waitForPaint() {
        return new Promise(function (resolve) {
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(function () {
                    window.setTimeout(resolve, 40);
                });
            });
        });
    }

    function logLine(message) {
        if (typeof console !== "undefined" && console.log) {
            console.log(message);
        }
    }

    /**
     * 切视图：首页 / 标注 / 拼图预览。
     * @param {"home"|"editor"|"collage"} name
     */
    function showView(name) {
        els.homeView.hidden = name !== "home";
        if (els.homeThumbs) {
            els.homeThumbs.hidden = name !== "home";
        }
        els.editorView.hidden = name !== "editor";
        if (els.editorCanvasHost) {
            els.editorCanvasHost.hidden = name !== "editor";
        }
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
            const batchPhotos = pickOpenSingles(photos);
            const n = batchPhotos.length;
            els.statusText.textContent = "本批 " + n + " / " + CONFIG.BATCH_SIZE;
            if (els.progressFill) {
                const pct = Math.min(100, (n / CONFIG.BATCH_SIZE) * 100);
                els.progressFill.style.height = pct + "%";
                els.progressFill.style.width = "100%";
            }
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
                del.textContent = "×";
                del.setAttribute("aria-label", "删除");
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
     * @param {boolean} [fromAlbum]
     */
    /**
     * 把当前编辑中的图立刻写入本地库。同一张反复覆盖，关掉再开还在。
     * @param {{ensureText?: boolean, quiet?: boolean}} [options]
     * @returns {Promise<void>}
     */
    function persistCurrentEdit(options) {
        const opt = options || {};
        if (!editor) {
            return Promise.resolve();
        }
        const sampleId = (els.textInput.value || "").trim();
        if (opt.ensureText && sampleId && editor.ensureSampleText) {
            editor.ensureSampleText(sampleId);
        }
        let dataUrl;
        try {
            dataUrl = editor.exportDataUrl();
        } catch (err) {
            logLine("导出失败：" + err.message);
            return Promise.reject(err);
        }
        if (!currentEditId) {
            currentEditId =
                "p-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
            currentEditCreatedAt = Date.now();
        }
        const photo = {
            id: currentEditId,
            batchId: currentBatchId,
            sampleId: sampleId,
            dataUrl: dataUrl,
            createdAt: currentEditCreatedAt,
            isCollage: false,
        };
        return window.PhotoStorage.savePhoto(photo).then(function () {
            window.PhotoStorage.saveOpenBatchId(currentBatchId);
            if (!opt.quiet) {
                if (window.PhotoStorage.isPersistWeak()) {
                    showToast("这张没存住，关掉会丢。请用手机浏览器打开网上链接");
                } else {
                    showToast("已自动保存");
                }
            }
        });
    }

    /**
     * 标注后稍等再存，避免画一笔就卡一下。
     */
    function schedulePersist() {
        clearTimeout(schedulePersist.timer);
        schedulePersist.timer = setTimeout(function () {
            persistCurrentEdit({ quiet: true }).catch(function (err) {
                logLine("自动保存失败：" + err.message);
            });
        }, 280);
    }

    /**
     * 离开标注页，图已经在库里，不用再点一次保存。
     */
    function leaveEditor() {
        clearTimeout(schedulePersist.timer);
        if (editor && editor.destroy) {
            editor.destroy();
        }
        editor = null;
        editorImage = null;
        currentEditId = "";
        currentEditCreatedAt = 0;
        showView("home");
        return refreshHome();
    }

    function openEditorWithFile(file, fromAlbum) {
        currentFromAlbum = !!fromAlbum;
        currentEditId = "";
        currentEditCreatedAt = 0;
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
                    "已打开照片 " +
                        image.naturalWidth +
                        "×" +
                        image.naturalHeight +
                        "（" +
                        mega +
                        "MP），已自动保存"
                );
                return persistCurrentEdit();
            })
            .catch(function (err) {
                logLine("打开照片失败：" + err.message);
                showToast("打开失败：" + err.message);
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
        openEditorWithFile(next, true);
    }

    /**
     * 取出还没拼过的单图，不按批次号过滤，避免只拼到一张。
     * @param {Array} photos
     * @returns {Array}
     */
    function pickOpenSingles(photos) {
        return (photos || []).filter(function (item) {
            return item && !item.isCollage && item.dataUrl;
        });
    }

    /**
     * 当前这批未拼过的细节图。
     * @returns {Promise<Array>}
     */
    function getCurrentBatchPhotos() {
        return window.PhotoStorage.listPhotos().then(pickOpenSingles);
    }

    /**
     * 生成拼图并进入预览。满 9 张或点「提前拼图」都走这里。
     * @param {boolean} autoTrigger
     */
    function makeCollage(autoTrigger) {
        showToast("正在拼图，请稍候", true);
        return waitForPaint()
            .then(function () {
                return getCurrentBatchPhotos();
            })
            .then(function (photos) {
                if (!photos.length) {
                    throw new Error("还没有已保存的细节图");
                }
                // 一页最多 9 张；多出来的等下一批，避免挤出画布
                const page = photos.slice(0, CONFIG.BATCH_SIZE);
                logLine(
                    (autoTrigger ? "已满 " + CONFIG.BATCH_SIZE + " 张，" : "提前") +
                        "开始拼图，共 " +
                        page.length +
                        " 张"
                );
                showToast("正在拼图，共 " + page.length + " 张", true);
                const urls = page.map(function (item) {
                    return item.dataUrl;
                });
                return window.PhotoCollage.buildCollage(urls).then(function (dataUrl) {
                    pendingCollageUrl = dataUrl;
                    pendingSavePack = [
                        {
                            dataUrl: dataUrl,
                            filename: "collage_" + currentBatchId + ".jpg",
                        },
                    ];
                    pendingSingleIds = [];
                    page.forEach(function (item, index) {
                        const name =
                            (item.sampleId || "sample") +
                            "_" +
                            currentBatchId +
                            "_" +
                            String(index + 1).padStart(2, "0") +
                            ".jpg";
                        pendingSavePack.push({ dataUrl: item.dataUrl, filename: name });
                        pendingSingleIds.push(item.id);
                    });
                    if (els.collagePreview) {
                        els.collagePreview.src = dataUrl;
                        els.collagePreview.alt = page.length + "张拼图";
                    }
                    if (els.collageCount) {
                        els.collageCount.textContent = "本页 " + page.length + " 张";
                    }
                    showView("collage");
                    logLine("拼图已生成，共 " + page.length + " 张，请点「保存拼图」");
                    showToast("已拼 " + page.length + " 张，请点「保存拼图」");
                    return page;
                });
            })
            .catch(function (err) {
                showToast("拼图失败：" + err.message);
                throw err;
            });
    }

    /**
     * 记住当前批次，闪退后再打开还能看到未拼完的图。
     * @param {string} batchId
     */
    function setCurrentBatch(batchId) {
        currentBatchId = batchId;
        window.PhotoStorage.saveOpenBatchId(batchId);
    }

    /**
     * 「完成」只是离开标注。图在打开时已经存过，这里再覆盖一次最新标注。
     */
    function saveEditedPhoto() {
        if (!editor) {
            logLine("没有正在编辑的照片");
            return;
        }
        els.btnSaveEdit.disabled = true;
        persistCurrentEdit({ ensureText: true })
            .then(function () {
                logLine("已更新本张，返回本批");
                return leaveEditor();
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
                showToast("没存住：" + err.message);
            })
            .then(function () {
                els.btnSaveEdit.disabled = false;
            });
    }

    /**
     * 拼图后把拼图和本批单图存到手机。
     * 单图仍留在本批，只有用户点「清空」才删除。
     */
    function saveCollageAndRotateBatch() {
        if (!pendingCollageUrl || !pendingSavePack.length) {
            logLine("没有待保存的拼图");
            return Promise.resolve();
        }
        const collageUrl = pendingCollageUrl;
        const pack = pendingSavePack.slice();
        const record = {
            id: "c-" + Date.now(),
            batchId: currentBatchId,
            sampleId: "拼图",
            dataUrl: collageUrl,
            createdAt: Date.now(),
            isCollage: true,
        };

        els.btnSaveCollage.disabled = true;
        // 立刻开始保存，保留这次点击手势，避免浏览器拦截分享/下载
        return window.PhotoSave.saveManyToPhone(pack)
            .then(function (result) {
                return window.PhotoStorage.savePhoto(record).then(function () {
                    return result;
                });
            })
            .then(function (result) {
                const singleCount = Math.max(0, pack.length - 1);
                const method = result && result.method;
                if (method === "share") {
                    logLine(
                        "已用系统分享一次保存拼图和 " + singleCount + " 张单图，照片仍留在本批"
                    );
                    showToast("请在面板里选存储图像，一次能存全部");
                } else {
                    logLine("已开始下载拼图和 " + singleCount + " 张单图，照片仍留在本批");
                    showToast("已开始下载拼图和单图，照片还在，要点清空才删");
                    if (window.PhotoSave.isIOS()) {
                        showSaveSheet(collageUrl);
                    }
                }
                pendingCollageUrl = "";
                pendingSavePack = [];
                pendingSingleIds = [];
                showView("home");
                return refreshHome();
            })
            .then(function () {
                openNextQueuedFile();
            })
            .catch(function (err) {
                logLine("拼图保存失败：" + err.message);
                showToast("还没存下，照片还在，请再点一次保存");
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
                openEditorWithFile(file, false);
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
            persistCurrentEdit({ quiet: true })
                .catch(function () {
                    return null;
                })
                .then(function () {
                    logLine("已返回，这张早就自动保存了");
                    return leaveEditor();
                })
                .then(function () {
                    openNextQueuedFile();
                });
        });
        els.btnSaveEdit.addEventListener("click", saveEditedPhoto);
        els.editorCanvas.addEventListener("marks-changed", function () {
            schedulePersist();
        });
        els.textInput.addEventListener("change", function () {
            schedulePersist();
        });

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
            pendingSavePack = [];
            pendingSingleIds = [];
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
                    setCurrentBatch(window.PhotoStorage.makeBatchId());
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
        if (window.PhotoStorage.requestPersist) {
            window.PhotoStorage.requestPersist();
        }
        window.PhotoStorage.listPhotos()
            .then(function (photos) {
                setCurrentBatch(window.PhotoStorage.resolveOpenBatchId(photos));
                const leftover = pickOpenSingles(photos);
                if (leftover.length) {
                    logLine("已恢复未完成批次，共 " + leftover.length + " 张");
                    showToast("已恢复 " + leftover.length + " 张，关掉也会留着");
                } else if (
                    window.PhotoStorage.readManifestCount &&
                    window.PhotoStorage.readManifestCount() > 0
                ) {
                    logLine("本地库是空的，但上次记过有图");
                    showToast("上次的图被浏览器清掉了，不要用无痕或微信");
                } else {
                    logLine("新批次 " + currentBatchId + "。完成会记住，关掉再开还在");
                }
                return refreshHome();
            })
            .catch(function (err) {
                logLine("初始化失败：" + err.message);
            });
        window.addEventListener("pageshow", function () {
            refreshHome();
        });
        window.addEventListener("pagehide", function () {
            if (editor) {
                persistCurrentEdit({ quiet: true, ensureText: true });
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
