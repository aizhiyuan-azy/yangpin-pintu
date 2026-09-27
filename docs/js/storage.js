/**
 * 用 IndexedDB 保存本批次标注图。关掉浏览器、过半小时再来，图还在。
 * 只存已经「完成标注」的图。只有点「清空」才整批删除。
 */
(function (global) {
    const CONFIG = global.APP_CONFIG;
    const STORE = "photos";
    const MANIFEST_KEY = CONFIG.BATCH_KEY + "-n";
    /** 本页临时备份。不能代替本地库，关掉页面就会没 */
    const memoryRows = [];
    /** 这次没写进本地库，关掉会丢，界面要提醒 */
    let persistWeak = false;

    /**
     * 打开（或创建）本地数据库。每次都试，不因为一次失败就放弃。
     * @returns {Promise<IDBDatabase>}
     */
    function openDb() {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) {
                reject(new Error("浏览器没有本地库"));
                return;
            }
            const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
            request.onerror = function () {
                reject(request.error || new Error("打开本地缓存失败"));
            };
            request.onblocked = function () {
                reject(new Error("本地库被占用"));
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
     * 向浏览器申请「不要自动清掉这个网页的缓存」。
     * @returns {Promise<boolean>}
     */
    function requestPersist() {
        try {
            if (navigator.storage && navigator.storage.persist) {
                return navigator.storage.persist().catch(function () {
                    return false;
                });
            }
        } catch (err) {
            // 旧浏览器没有这个接口
        }
        return Promise.resolve(false);
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
     * 未拼完单图张数，写在 localStorage，用来发现「库被清掉了」。
     * @param {Array} photos
     */
    function writeManifest(photos) {
        try {
            const n = (photos || []).filter(function (item) {
                return !item.isCollage;
            }).length;
            localStorage.setItem(MANIFEST_KEY, String(n));
        } catch (err) {
            // 无痕模式可能写不了
        }
    }

    /**
     * 上次记住的单图张数。读不到当 0。
     * @returns {number}
     */
    function readManifestCount() {
        try {
            return parseInt(localStorage.getItem(MANIFEST_KEY) || "0", 10) || 0;
        } catch (err) {
            return 0;
        }
    }

    /**
     * 本页内存里也留一份，仅供本地库暂时打不开时顶上。
     * @param {Object} photo
     */
    function rememberInRam(photo) {
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
    }

    function sortByTime(rows) {
        const list = (rows || []).slice();
        list.sort(function (a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
        });
        return list;
    }

    /**
     * 从已打开的库读出全部照片。
     * @param {IDBDatabase} db
     * @returns {Promise<Array>}
     */
    function readAllFromDb(db) {
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE, "readonly");
            const rows = [];
            const request = tx.objectStore(STORE).openCursor();
            request.onsuccess = function (event) {
                const cursor = event.target.result;
                if (cursor) {
                    rows.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(sortByTime(rows));
                }
            };
            request.onerror = function () {
                reject(request.error || new Error("读取照片失败"));
            };
        });
    }

    /**
     * 本地库和本页内存合并。库只写出 1 张、后面几张还在内存时，拼图不能只用库里那一张。
     * @param {Array} dbRows
     * @param {Array} ramRows
     * @returns {Array}
     */
    function mergeRows(dbRows, ramRows) {
        const map = {};
        (dbRows || []).forEach(function (item) {
            if (item && item.id) {
                map[item.id] = item;
            }
        });
        (ramRows || []).forEach(function (item) {
            if (item && item.id) {
                map[item.id] = item;
            }
        });
        const merged = [];
        Object.keys(map).forEach(function (key) {
            merged.push(map[key]);
        });
        return sortByTime(merged);
    }

    /**
     * 写入一张已标注照片。先写本地库，成功才算记住。
     * @param {Object} photo
     * @returns {Promise<void>}
     */
    function savePhoto(photo) {
        rememberInRam(photo);
        return openDb()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    const tx = db.transaction(STORE, "readwrite");
                    tx.oncomplete = function () {
                        persistWeak = false;
                        resolve();
                    };
                    tx.onerror = function () {
                        reject(tx.error || new Error("保存照片失败"));
                    };
                    tx.objectStore(STORE).put(photo);
                }).then(function () {
                    writeManifest(memoryRows);
                });
            })
            .catch(function () {
                persistWeak = true;
                writeManifest(memoryRows);
                return Promise.resolve();
            });
    }

    /**
     * 读取全部照片，按时间从旧到新。优先本地库，关掉再开也能读到。
     * @returns {Promise<Array>}
     */
    function listPhotos() {
        return openDb()
            .then(function (db) {
                return readAllFromDb(db).then(function (rows) {
                    const merged = mergeRows(rows, memoryRows);
                    if (merged.length) {
                        persistWeak = merged.length > rows.length;
                    }
                    writeManifest(merged);
                    return merged;
                });
            })
            .catch(function () {
                persistWeak = memoryRows.length > 0 || persistWeak;
                return sortByTime(memoryRows);
            });
    }

    /**
     * 按 id 删除一张。
     * @param {string} photoId
     * @returns {Promise<void>}
     */
    function deletePhoto(photoId) {
        for (let i = memoryRows.length - 1; i >= 0; i -= 1) {
            if (memoryRows[i].id === photoId) {
                memoryRows.splice(i, 1);
            }
        }
        return openDb()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    const tx = db.transaction(STORE, "readwrite");
                    tx.oncomplete = function () {
                        resolve();
                    };
                    tx.onerror = function () {
                        reject(tx.error || new Error("删除照片失败"));
                    };
                    tx.objectStore(STORE).delete(photoId);
                }).then(function () {
                    writeManifest(memoryRows);
                });
            })
            .catch(function () {
                writeManifest(memoryRows);
                return Promise.resolve();
            });
    }

    /**
     * 清空全部缓存（只有用户点「清空」时才走这里）。
     * @returns {Promise<void>}
     */
    function clearAll() {
        memoryRows.length = 0;
        persistWeak = false;
        writeManifest([]);
        return openDb()
            .then(function (db) {
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
            })
            .catch(function () {
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
        const singlesOf = function (batchId) {
            return rows.filter(function (item) {
                return item.batchId === batchId && !item.isCollage;
            });
        };
        if (stored && singlesOf(stored).length) {
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
        if (latest) {
            return latest;
        }
        return stored || makeBatchId();
    }

    /**
     * 这次有没有真正写进本地库。true 表示关掉页面会丢。
     * @returns {boolean}
     */
    function isPersistWeak() {
        return persistWeak;
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
        requestPersist: requestPersist,
        readManifestCount: readManifestCount,
        isPersistWeak: isPersistWeak,
    };
})(window);
