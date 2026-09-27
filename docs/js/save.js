/**
 * 把图片存到手机：优先系统分享（可选「存储图像」），
 * 不行再触发下载。微信内置浏览器能力弱，页面会提示换系统浏览器。
 */
(function (global) {
    /**
     * 判断是否在微信内置浏览器。
     * @returns {boolean}
     */
    function isWeChat() {
        return /MicroMessenger/i.test(navigator.userAgent || "");
    }

    /**
     * 判断是否 iOS。
     * @returns {boolean}
     */
    function isIOS() {
        return /iPad|iPhone|iPod/i.test(navigator.userAgent || "");
    }

    /**
     * 百度 / 夸克 / UC / 手机自带浏览器（国内安卓常用）。
     * @returns {boolean}
     */
    function isDomesticBrowser() {
        const ua = navigator.userAgent || "";
        return /baidu|bdbrowser|baiduboxapp|UCBrowser|UCWEB|Quark|HuaweiBrowser|MiuiBrowser|XiaoMi|MQQBrowser|VivoBrowser|HeyTap|OPPO|SamsungBrowser/i.test(
            ua
        );
    }

    /**
     * 谷歌 Chrome（国内套壳浏览器 UA 里也有 Chrome，要排除）。
     * @returns {boolean}
     */
    function isChrome() {
        const ua = navigator.userAgent || "";
        if (isDomesticBrowser() || isWeChat() || isIOS()) {
            return false;
        }
        return /Chrome/i.test(ua) && !/Edg|OPR/i.test(ua);
    }

    /**
     * 把 dataURL 转成 Blob，避免超大图用 atob 爆内存。
     * @param {string} dataUrl
     * @returns {Blob}
     */
    function dataUrlToBlob(dataUrl) {
        const parts = dataUrl.split(",");
        const mimeMatch = (parts[0] || "").match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
        const binary = atob(parts[1] || "");
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
    }

    /**
     * 触发浏览器下载（安卓 Chrome 通常进「下载」或相册）。
     * @param {Blob} blob
     * @param {string} filename
     */
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 4000);
    }

    /**
     * 是否安卓手机。
     * @returns {boolean}
     */
    function isAndroid() {
        return /Android/i.test(navigator.userAgent || "");
    }

    /**
     * 手机才走系统分享。电脑 Chrome 分享面板经常是空的，点了等于没存。
     * @returns {boolean}
     */
    function isPhone() {
        return isIOS() || isAndroid();
    }

    /**
     * 苹果和安卓手机都可以一次分享多张；微信和电脑不走这条。
     * @returns {boolean}
     */
    function canUseShare() {
        return isPhone() && !isWeChat() && typeof navigator.share === "function";
    }

    /**
     * 把待存清单转成系统分享要用的 File 列表。转失败返回空数组。
     * @param {Array<{dataUrl:string,filename:string}>} list
     * @returns {File[]}
     */
    function listToShareFiles(list) {
        const files = [];
        if (typeof File !== "function") {
            return files;
        }
        for (let i = 0; i < list.length; i += 1) {
            try {
                const blob = dataUrlToBlob(list[i].dataUrl);
                files.push(
                    new File([blob], list[i].filename, { type: blob.type || "image/jpeg" })
                );
            } catch (err) {
                return [];
            }
        }
        return files;
    }

    /**
     * 保存一张图到手机。苹果可走分享，其它浏览器直接下载。
     * @param {string} dataUrl
     * @param {string} filename
     * @returns {Promise<{method: string}>}
     */
    function saveImageToPhone(dataUrl, filename) {
        const blob = dataUrlToBlob(dataUrl);
        try {
            if (canUseShare() && typeof File === "function" && navigator.canShare) {
                const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
                if (navigator.canShare({ files: [file] })) {
                    return navigator
                        .share({
                            files: [file],
                            title: filename,
                            text: "样品照片",
                        })
                        .then(function () {
                            return { method: "share" };
                        })
                        .catch(function (err) {
                            if (err && err.name === "AbortError") {
                                downloadBlob(blob, filename);
                                return { method: "download-after-cancel" };
                            }
                            downloadBlob(blob, filename);
                            return { method: "download" };
                        });
                }
            }
        } catch (err) {
            // 百度等浏览器可能没有 File / share，改走下载和长按保存
        }

        downloadBlob(blob, filename);
        return Promise.resolve({ method: "download" });
    }

    /**
     * 一张张触发下载。第一张立刻下（还在用户点击里，浏览器不会拦），
     * 后面隔开一点，避免一次点十个被拦截。
     * @param {Array<{dataUrl:string,filename:string}>} list
     * @returns {Promise<void>}
     */
    function downloadListSequentially(list) {
        return new Promise(function (resolve) {
            let index = 0;
            function next() {
                if (index >= list.length) {
                    resolve();
                    return;
                }
                const item = list[index];
                index += 1;
                downloadBlob(dataUrlToBlob(item.dataUrl), item.filename);
                window.setTimeout(next, 380);
            }
            next();
        });
    }

    /**
     * 点一次后连续下载多张 jpg。电脑走这条，不打包。
     * @param {Array<{dataUrl:string,filename:string}>} list
     * @returns {Promise<{method:string,count:number}>}
     */
    function downloadAllJpgs(list) {
        return downloadListSequentially(list).then(function () {
            return { method: "download", count: list.length };
        });
    }

    /**
     * 拼图完成后一次存多张，不再打压缩包。
     * 苹果 / 安卓夸克：系统分享，一次带上拼图和全部单图。
     * 电脑或不支持分享：点一次后连续下载多张 jpg。
     * @param {Array<{dataUrl:string,filename:string}>} items
     * @returns {Promise<{method:string,count:number}>}
     */
    function saveManyToPhone(items) {
        const list = (items || []).filter(function (item) {
            return item && item.dataUrl && item.filename;
        });
        if (!list.length) {
            return Promise.reject(new Error("没有可保存的图片"));
        }

        try {
            if (canUseShare() && navigator.canShare) {
                const files = listToShareFiles(list);
                if (files.length === list.length && navigator.canShare({ files: files })) {
                    return navigator
                        .share({
                            files: files,
                            title: "本批样品",
                            text: "拼图和单图",
                        })
                        .then(function () {
                            return { method: "share", count: files.length };
                        })
                        .catch(function (err) {
                            if (err && err.name === "AbortError") {
                                return Promise.reject(new Error("已取消保存"));
                            }
                            return downloadAllJpgs(list);
                        });
                }
            }
        } catch (err) {
            // 分享接口异常时走原来的连续下载
        }

        return downloadAllJpgs(list);
    }

    /**
     * 给苹果手机看的提示：HTTP 局域网经常不能直接写入相册。
     * @returns {string}
     */
    function saveHint() {
        if (isIOS()) {
            return "苹果请在分享面板里选「存储图像」，一次能存拼图和全部单图。发微信时请勾选原图。";
        }
        if (isAndroid()) {
            return "安卓请用夸克，在分享面板一次保存全部。发微信时请勾选原图。";
        }
        return "会连续下载拼图和全部单图到下载栏。发微信时请勾选原图。";
    }

    global.PhotoSave = {
        isWeChat: isWeChat,
        isIOS: isIOS,
        isAndroid: isAndroid,
        isChrome: isChrome,
        isDomesticBrowser: isDomesticBrowser,
        dataUrlToBlob: dataUrlToBlob,
        downloadBlob: downloadBlob,
        saveImageToPhone: saveImageToPhone,
        saveManyToPhone: saveManyToPhone,
        saveHint: saveHint,
    };
})(window);
