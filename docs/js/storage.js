/**
 * 用 IndexedDB 保存本批次标注图，刷新页面也不会丢。
 * 只存已经「完成标注」的图，不存拍摄中的临时数据。
 */
(function (global) {
    const CONFIG = global.APP_CONFIG;
    const STORE = "photos";
    /** 离线单文件（file://）时 IndexedDB 可能不可用，用内存顶上 */
    const memoryRows = [];
    let useMemory = false;

    /**
     * 打开（或创建）本地数据库。
     * @returns {Promise<IDBDatabase>}
     */
    function openDb() {
        return new Promise(function (resolve, reject) {
            if (useMemory || !window.indexedDB) {
                reject(new Error("改用内存缓存"));
                return;
            }
            const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
            request.onerror = function () {
                reject(request.error || new Error("打开本地缓存失败"));
            };
            request.onsuccess = function () {
                resolve(request.result);
            };
            request.onupgradeneeded = function (event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: "id" });
                    store.createIndex("createdAt", "createdAt", { unique: false });
                    store.createIndex("batchId", "batchId", { unique: false });
                }
            };
        });
    }

    /**
     * 生成当前批次编号（按日期，方便对账）。
     * @returns {string}
     */
    function makeBatchId() {
        const now = new Date();
        const pad = function (n) {
            return String(n).padStart(2, "0");
        };
        return (
            now.getFullYear() +
            pad(now.getMonth() + 1) +
            pad(now.getDate()) +
            "-" +
            pad(now.getHours()) +
            pad(now.getMinutes())
        );
    }

    /**
     * 写入一张已标注照片。
     * @param {Object} photo
     * @returns {Promise<void>}
     */
    function saveToMemory(photo) {
        useMemory = true;
        let found = false;
        for (let i = 0; i < memoryRows.length; i += 1) {
            if (memoryRows[i].id === photo.id) {
                memoryRows[i] = photo;
                found = true;
                break;
            }
        }
        if (!found) {
            memoryRows.push(photo);
        }
        return Promise.resolve();
    }

    function savePhoto(photo) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE, "readwrite");
                tx.oncomplete = function () {
                    resolve();
                };
                tx.onerror = function () {
                    reject(tx.error || new Error("保存照片失败"));
                };
                tx.objectStore(STORE).put(photo);
            });
        }).catch(function () {
            return saveToMemory(photo);
        });
    }

    /**
     * 读取全部照片，按时间从旧到新。
     * @returns {Promise<Array>}
     */
    function listPhotos() {
        if (useMemory) {
            const rows = memoryRows.slice();
            rows.sort(function (a, b) {
                return (a.createdAt || 0) - (b.createdAt || 0);
            });
            return Promise.resolve(rows);
        }
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE, "readonly");
                const request = tx.objectStore(STORE).getAll();
                request.onsuccess = function () {
                    const rows = request.result || [];
                    rows.sort(function (a, b) {
                        return (a.createdAt || 0) - (b.createdAt || 0);
                    });
                    resolve(rows);
                };
                request.onerror = function () {
                    reject(request.error || new Error("读取照片失败"));
                };
            });
        }).catch(function () {
            useMemory = true;
            return Promise.resolve(memoryRows.slice());
        });
    }

    /**
     * 按 id 删除一张。
     * @param {string} photoId
     * @returns {Promise<void>}
     */
    function deletePhoto(photoId) {
        if (useMemory) {
            for (let i = memoryRows.length - 1; i >= 0; i -= 1) {
                if (memoryRows[i].id === photoId) {
                    memoryRows.splice(i, 1);
                }
            }
            return Promise.resolve();
        }
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE, "readwrite");
                tx.oncomplete = function () {
                    resolve();
                };
                tx.onerror = function () {
                    reject(tx.error || new Error("删除照片失败"));
                };
                tx.objectStore(STORE).delete(photoId);
            });
        }).catch(function () {
            useMemory = true;
            return deletePhoto(photoId);
        });
    }

    /**
     * 清空全部缓存（换班或开始新任务时用）。
     * @returns {Promise<void>}
     */
    function clearAll() {
        memoryRows.length = 0;
        if (useMemory) {
            return Promise.resolve();
        }
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE, "readwrite");
                tx.oncomplete = function () {
                    resolve();
                };
                tx.onerror = function () {
                    reject(tx.error || new Error("清空缓存失败"));
                };
                tx.objectStore(STORE).clear();
            });
        }).catch(function () {
            useMemory = true;
            return Promise.resolve();
        });
    }

    /**
     * 读出上次未完成的批次号。读不到就返回空字符串。
     * @returns {string}
     */
    function loadOpenBatchId() {
        try {
            return localStorage.getItem(CONFIG.BATCH_KEY) || "";
        } catch (err) {
            return "";
        }
    }

    /**
     * 记住当前批次，下次打开还用这一批。
     * @param {string} batchId
     */
    function saveOpenBatchId(batchId) {
        try {
            if (batchId) {
                localStorage.setItem(CONFIG.BATCH_KEY, batchId);
            } else {
                localStorage.removeItem(CONFIG.BATCH_KEY);
            }
        } catch (err) {
            // 无痕模式可能写不了，忽略
        }
    }

    /**
     * 在已有照片里找回未拼完的批次：先看记住的号，再看最新一批没拼图的。
     * @param {Array} photos
     * @returns {string}
     */
    function resolveOpenBatchId(photos) {
        const rows = photos || [];
        const stored = loadOpenBatchId();
        const hasOpen = function (batchId) {
            const inBatch = rows.filter(function (item) {
                return item.batchId === batchId;
            });
            if (!inBatch.length) {
                return true;
            }
            return !inBatch.some(function (item) {
                return item.isCollage;
            });
        };
        if (stored && hasOpen(stored)) {
            return stored;
        }
        let latest = "";
        let latestAt = -1;
        rows.forEach(function (item) {
            if (item.isCollage) {
                return;
            }
            if ((item.createdAt || 0) >= latestAt) {
                latestAt = item.createdAt || 0;
                latest = item.batchId;
            }
        });
        if (latest && hasOpen(latest)) {
            return latest;
        }
        return makeBatchId();
    }

    global.PhotoStorage = {
        makeBatchId: makeBatchId,
        savePhoto: savePhoto,
        listPhotos: listPhotos,
        deletePhoto: deletePhoto,
        clearAll: clearAll,
        loadOpenBatchId: loadOpenBatchId,
        saveOpenBatchId: saveOpenBatchId,
        resolveOpenBatchId: resolveOpenBatchId,
    };
})(window);
