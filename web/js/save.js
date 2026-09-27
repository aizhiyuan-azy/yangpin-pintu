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
     * 保存一张图到手机。先分享，再下载，保证至少有一条路能留下原图。
     * @param {string} dataUrl
     * @param {string} filename
     * @returns {Promise<{method: string}>}
     */
    function saveImageToPhone(dataUrl, filename) {
        const blob = dataUrlToBlob(dataUrl);
        try {
            if (typeof File === "function" && navigator.canShare) {
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
     * 给苹果手机看的提示：HTTP 局域网经常不能直接写入相册。
     * @returns {string}
     */
    function saveHint() {
        if (isIOS()) {
            return "苹果手机请长按图片 → 选择「存储图像」。发微信时请勾选原图。";
        }
        return "请长按图片 → 保存到相册。百度浏览器常常不会自动下载。发微信时请勾选原图。";
    }

    global.PhotoSave = {
        isWeChat: isWeChat,
        isIOS: isIOS,
        isChrome: isChrome,
        isDomesticBrowser: isDomesticBrowser,
        dataUrlToBlob: dataUrlToBlob,
        downloadBlob: downloadBlob,
        saveImageToPhone: saveImageToPhone,
        saveHint: saveHint,
    };
})(window);
