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

    global.PhotoStorage = {
        makeBatchId: makeBatchId,
        savePhoto: savePhoto,
        listPhotos: listPhotos,
        deletePhoto: deletePhoto,
        clearAll: clearAll,
    };
})(window);
