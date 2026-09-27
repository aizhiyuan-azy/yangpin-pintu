/**
 * 不依赖第三方库，把多张图打成 ZIP（只存储、不压缩）。
 * 车间一键保存时用：浏览器不能一次分享多张，就下一个压缩包。
 */
(function (global) {
    /** CRC32 查表，只算一次 */
    const CRC_TABLE = (function () {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i += 1) {
            let crc = i;
            for (let bit = 0; bit < 8; bit += 1) {
                crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
            }
            table[i] = crc >>> 0;
        }
        return table;
    })();

    /**
     * 算一段字节的 CRC32，ZIP 目录里要写这个校验。
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    function crc32(bytes) {
        let crc = 0xffffffff;
        const data = bytes || new Uint8Array(0);
        for (let i = 0; i < data.length; i += 1) {
            crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    /**
     * 文件名转 UTF-8 字节。旧浏览器没有 TextEncoder 时用备用算法。
     * @param {string} text
     * @returns {Uint8Array}
     */
    function encodeUtf8(text) {
        const value = text == null ? "" : String(text);
        if (window.TextEncoder) {
            return new TextEncoder().encode(value);
        }
        try {
            const raw = unescape(encodeURIComponent(value));
            const out = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i += 1) {
                out[i] = raw.charCodeAt(i);
            }
            return out;
        } catch (err) {
            const fallback = new Uint8Array(value.length);
            for (let i = 0; i < value.length; i += 1) {
                fallback[i] = value.charCodeAt(i) & 0xff;
            }
            return fallback;
        }
    }

    /**
     * 去掉路径分隔符，避免压缩包里出现非法路径。
     * @param {string} name
     * @returns {string}
     */
    function safeEntryName(name) {
        const raw = String(name || "photo.jpg").replace(/\\/g, "/");
        const parts = raw.split("/");
        const base = parts[parts.length - 1] || "photo.jpg";
        return base.replace(/[:*?"<>|]/g, "_") || "photo.jpg";
    }

    function u16(n) {
        return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
    }

    function u32(n) {
        return new Uint8Array([
            n & 0xff,
            (n >>> 8) & 0xff,
            (n >>> 16) & 0xff,
            (n >>> 24) & 0xff,
        ]);
    }

    /**
     * 把多段字节拼成一段。
     * @param {Uint8Array[]} parts
     * @returns {Uint8Array}
     */
    function concatBytes(parts) {
        let total = 0;
        for (let i = 0; i < parts.length; i += 1) {
            total += parts[i].length;
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (let i = 0; i < parts.length; i += 1) {
            out.set(parts[i], offset);
            offset += parts[i].length;
        }
        return out;
    }

    /**
     * 按 STORE 方式打 ZIP。空列表会失败。
     * @param {Array<{name: string, bytes: Uint8Array}>} entries
     * @returns {Blob}
     */
    function buildStoreZip(entries) {
        const list = (entries || []).filter(function (item) {
            return item && item.bytes;
        });
        if (!list.length) {
            throw new Error("没有可打包的照片");
        }

        const locals = [];
        const centrals = [];
        let offset = 0;

        for (let i = 0; i < list.length; i += 1) {
            const nameBytes = encodeUtf8(safeEntryName(list[i].name));
            const data = list[i].bytes;
            const crc = crc32(data);
            const size = data.length;
            // 0x0800：文件名按 UTF-8，中文型号不会乱码
            const flags = 0x0800;
            const local = concatBytes([
                new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
                u16(20),
                u16(flags),
                u16(0),
                u16(0),
                u16(0),
                u32(crc),
                u32(size),
                u32(size),
                u16(nameBytes.length),
                u16(0),
                nameBytes,
                data,
            ]);
            locals.push(local);

            const central = concatBytes([
                new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
                u16(20),
                u16(20),
                u16(flags),
                u16(0),
                u16(0),
                u16(0),
                u32(crc),
                u32(size),
                u32(size),
                u16(nameBytes.length),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(0),
                u32(offset),
                nameBytes,
            ]);
            centrals.push(central);
            offset += local.length;
        }

        const centralDir = concatBytes(centrals);
        const eocd = concatBytes([
            new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
            u16(0),
            u16(0),
            u16(list.length),
            u16(list.length),
            u32(centralDir.length),
            u32(offset),
            u16(0),
        ]);

        return new Blob([concatBytes(locals.concat([centralDir, eocd]))], {
            type: "application/zip",
        });
    }

    global.PhotoZip = {
        crc32: crc32,
        encodeUtf8: encodeUtf8,
        safeEntryName: safeEntryName,
        buildStoreZip: buildStoreZip,
    };
})(window);
