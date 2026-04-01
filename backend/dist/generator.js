"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearFileCache = clearFileCache;
exports.findPptPath = findPptPath;
exports.findScorePath = findScorePath;
exports.extractSongData = extractSongData;
exports.generateFiles = generateFiles;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const archiver_1 = __importDefault(require("archiver"));
const winston_1 = __importDefault(require("winston"));
const generatorLogger = winston_1.default.createLogger({
    level: 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })),
    transports: [
        new winston_1.default.transports.Console(),
        new winston_1.default.transports.File({ filename: 'generator.log' }),
    ],
});
// 🚀 第一部分：Node.js 快速檔案掃描 (解決缺檔顯示問題)
// 外部同步（雲端→NAS）新增檔案後，需讓快取過期才會更新「有無 PPT」狀態；上傳 API 仍會手動 clear。
let fileCache = null;
let fileCacheRoot = null;
let fileCacheBuiltAt = 0;
/** 歌譜 PDF：檔名如 `401你是否曾求救主洗罪能.pdf`（編號緊接歌名，可位於 401-500 等子資料夾） */
let scoreFileCache = null;
let scoreFileCacheRoot = null;
let scoreFileCacheBuiltAt = 0;
/** 掃描完成後以編號 → 首選路徑，查詢 O(1)（多檔時排序規則與舊版線性搜尋一致） */
let pptIdToPath = null;
let scoreIdToPath = null;
function rebuildPptIdMap() {
    pptIdToPath = new Map();
    if (!fileCache)
        return;
    const byId = new Map();
    for (const file of fileCache) {
        const fid = parseLeadingIdFromStem(file.name);
        if (fid === null)
            continue;
        const arr = byId.get(fid) ?? [];
        arr.push(file.path);
        byId.set(fid, arr);
    }
    for (const [id, paths] of byId) {
        paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        pptIdToPath.set(id, paths[0]);
    }
}
function rebuildScoreIdMap() {
    scoreIdToPath = new Map();
    if (!scoreFileCache)
        return;
    const byId = new Map();
    for (const file of scoreFileCache) {
        const fid = parseScoreFileId(file.name);
        if (fid === null)
            continue;
        const arr = byId.get(fid) ?? [];
        arr.push(file.path);
        byId.set(fid, arr);
    }
    for (const [id, paths] of byId) {
        paths.sort((a, b) => {
            const d = scorePathSortKey(a) - scorePathSortKey(b);
            if (d !== 0)
                return d;
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });
        scoreIdToPath.set(id, paths[0]);
    }
}
/** 毫秒。-1 = 不自動過期（與舊版相同，僅 upload / clearFileCache 會刷新）。預設 5 分鐘。 */
function getPptLibraryCacheTtlMs() {
    const raw = process.env.PPT_LIBRARY_CACHE_TTL_MS;
    if (raw === undefined || raw === '')
        return 300000;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n))
        return 300000;
    return n;
}
function shouldRebuildFileCache(rootPath) {
    if (!fileCache || fileCacheRoot !== rootPath)
        return true;
    const ttl = getPptLibraryCacheTtlMs();
    if (ttl < 0)
        return false;
    return Date.now() - fileCacheBuiltAt > ttl;
}
function shouldRebuildScoreCache(rootPath) {
    if (!scoreFileCache || scoreFileCacheRoot !== rootPath)
        return true;
    const ttl = getPptLibraryCacheTtlMs();
    if (ttl < 0)
        return false;
    return Date.now() - scoreFileCacheBuiltAt > ttl;
}
// 輔助：正規化字串 (去除非英數中文並轉小寫)
function normalizeString(str) {
    if (!str)
        return ""; // 防止 undefined 導致 crash
    return str.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
}
/** PPT 檔名慣例：`1280-歌名.pptx` → 只取連字號前的編號與清單 id 對應（含全形 －、–、—） */
function parseLeadingIdFromStem(stem) {
    const m = stem.match(/^(\d+)\s*[\-－–—]\s*(.*)$/u);
    if (!m)
        return null;
    const id = parseInt(m[1], 10);
    return Number.isNaN(id) ? null : id;
}
/** 全形數字 ０-９ → ASCII，避免 ^(\d+) 對不到 Synology／部分匯出檔名 */
function normalizeFullwidthDigits(s) {
    return s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
}
/** 歌譜 PDF：`401你是否曾求救主洗罪能` → 開頭連續數字為編號（與歌名無分隔） */
function parseScoreIdFromStem(stem) {
    const m = stem.replace(/^\uFEFF/, '').match(/^(\d+)/u);
    if (!m)
        return null;
    const id = parseInt(m[1], 10);
    return Number.isNaN(id) ? null : id;
}
/** 歌譜檔名可為 `401-歌名`（與 PPT 同）或 `401歌名`（緊接） */
function parseScoreFileId(stem) {
    const s = normalizeFullwidthDigits(stem.replace(/^\uFEFF/, '').normalize('NFC'));
    return parseLeadingIdFromStem(s) ?? parseScoreIdFromStem(s);
}
// 遞迴建立檔案快取
function buildFileCache(rootPath) {
    if (!fs.existsSync(rootPath)) {
        generatorLogger.warn(`⚠️ Path does not exist: ${rootPath}`);
        return;
    }
    const files = [];
    function traverse(currentPath) {
        if (!fs.existsSync(currentPath))
            return;
        try {
            const items = fs.readdirSync(currentPath);
            for (const item of items) {
                const fullPath = path.join(currentPath, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    traverse(fullPath);
                }
                else if (stat.isFile()) {
                    const ext = path.extname(item).toLowerCase();
                    if (ext === '.pptx' || ext === '.ppt') {
                        const fileName = path.basename(item, ext);
                        files.push({
                            name: fileName,
                            path: fullPath,
                            normalized: normalizeString(fileName)
                        });
                    }
                }
            }
        }
        catch (e) {
            // ignore permission errors etc.
        }
    }
    traverse(rootPath);
    fileCache = files;
    fileCacheRoot = rootPath;
    fileCacheBuiltAt = Date.now();
    rebuildPptIdMap();
    generatorLogger.info(`✅ Cache built. Found ${files.length} presentation files in ${rootPath}`);
}
/** 歌譜：PDF 與常見掃圖（檔名規則同：開頭編號 + 歌名） */
const SCORE_FILE_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
function isScoreExtension(ext) {
    return SCORE_FILE_EXTENSIONS.has(ext.toLowerCase());
}
/** 同編號多檔時優先：PDF > JPEG > PNG */
function scorePathSortKey(filePath) {
    const e = path.extname(filePath).toLowerCase();
    if (e === '.pdf')
        return 0;
    if (e === '.jpg' || e === '.jpeg')
        return 1;
    if (e === '.png')
        return 2;
    return 3;
}
function buildScoreFileCache(rootPath) {
    if (!fs.existsSync(rootPath)) {
        generatorLogger.warn(`⚠️ Score path does not exist: ${rootPath}`);
        return;
    }
    const files = [];
    function traverse(currentPath) {
        if (!fs.existsSync(currentPath))
            return;
        try {
            const items = fs.readdirSync(currentPath);
            for (const item of items) {
                const fullPath = path.join(currentPath, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    traverse(fullPath);
                }
                else if (stat.isFile()) {
                    const ext = path.extname(item).toLowerCase();
                    if (isScoreExtension(ext)) {
                        const fileName = path.basename(item, ext);
                        files.push({ name: fileName, path: fullPath });
                    }
                }
            }
        }
        catch {
            // ignore
        }
    }
    traverse(rootPath);
    scoreFileCache = files;
    scoreFileCacheRoot = rootPath;
    scoreFileCacheBuiltAt = Date.now();
    rebuildScoreIdMap();
    if (files.length === 0) {
        generatorLogger.warn(`⚠️ 歌譜根目錄下未掃到任何 PDF/JPG/PNG（請確認路徑或子資料夾 401-500 等是否可讀）: ${rootPath}`);
    }
    else {
        generatorLogger.info(`✅ Score cache built. Found ${files.length} score files in ${rootPath}`);
    }
}
function clearFileCache() {
    fileCache = null;
    fileCacheRoot = null;
    fileCacheBuiltAt = 0;
    pptIdToPath = null;
    scoreFileCache = null;
    scoreFileCacheRoot = null;
    scoreFileCacheBuiltAt = 0;
    scoreIdToPath = null;
    generatorLogger.info('🔄 File cache cleared.');
}
// 尋找 PPT 路徑
async function findPptPath(rootPath, song) {
    if (shouldRebuildFileCache(rootPath)) {
        fileCache = null;
        pptIdToPath = null;
    }
    if (!fileCache) {
        buildFileCache(rootPath);
    }
    if (!fileCache || !pptIdToPath)
        return null;
    const sid = Number(song?.id);
    if (!song || !Number.isFinite(sid))
        return null;
    return pptIdToPath.get(sid) ?? null;
}
/** 遞迴掃描歌譜根目錄（PDF / JPG / PNG；含 401-500 等子資料夾） */
async function findScorePath(rootPath, song) {
    if (!rootPath)
        return null;
    if (shouldRebuildScoreCache(rootPath)) {
        scoreFileCache = null;
        scoreIdToPath = null;
    }
    if (!scoreFileCache) {
        buildScoreFileCache(rootPath);
    }
    if (!scoreFileCache || !scoreIdToPath)
        return null;
    const sid = parseInt(String(song?.id).trim(), 10);
    if (!song || Number.isNaN(sid))
        return null;
    return scoreIdToPath.get(sid) ?? null;
}
// 🐍 第二部分：Python 腳本呼叫
async function runPythonScript(mode, payload, outputDir) {
    // 🛠️ 修正：使用 process.cwd() 確保指向 /app (Docker) 或 專案根目錄 (Local)
    const PROJECT_ROOT = process.cwd();
    // Detect resources path (Local dev: ../resources, Docker/Prod: ./resources)
    const RESOURCES_DIR = fs.existsSync(path.join(PROJECT_ROOT, "../resources"))
        ? path.join(PROJECT_ROOT, "../resources")
        : path.join(PROJECT_ROOT, "resources");
    // 注意：腳本位置相對於 __dirname (dist/src) 
    const SCRIPT_PATH = path.join(__dirname, '../scripts/generator.py');
    return new Promise((resolve, reject) => {
        // 參數順序: script.py [mode] [json_data] [resources_dir] [output_dir?]
        const args = [SCRIPT_PATH, mode, JSON.stringify(payload), RESOURCES_DIR];
        if (outputDir)
            args.push(outputDir);
        generatorLogger.info(`🐍 Running Python: ${mode}`);
        generatorLogger.info(`📂 Resources Dir: ${RESOURCES_DIR}`);
        // 使用 spawn 執行 python
        const py = (0, child_process_1.spawn)('python', args);
        let stdoutData = '';
        let stderrData = '';
        py.stdout.on('data', (data) => { stdoutData += data.toString(); });
        py.stderr.on('data', (data) => { stderrData += data.toString(); });
        py.on('close', (code) => {
            if (code !== 0) {
                generatorLogger.error(`Python error (${code}): ${stderrData}`);
                return reject(new Error(`Python script failed: ${stderrData}`));
            }
            try {
                // Python 可能會輸出多行 log，我們只需要最後一行的 JSON 結果
                const lines = stdoutData.trim().split('\n');
                let result = null;
                // 從最後一行往回找 JSON
                for (let i = lines.length - 1; i >= 0; i--) {
                    try {
                        const json = JSON.parse(lines[i]);
                        if (json && (Array.isArray(json) || json.status || json.error)) {
                            result = json;
                            break;
                        }
                    }
                    catch (e) {
                        continue;
                    }
                }
                if (!result)
                    throw new Error('No JSON found in Python output');
                if (result.error)
                    return reject(new Error(result.error));
                resolve(result);
            }
            catch (e) {
                generatorLogger.error(`Invalid JSON from Python. Output: ${stdoutData}`);
                reject(new Error('Invalid response from Python script'));
            }
        });
    });
}
// 預覽功能
async function extractSongData(songs, pptLibraryPath) {
    const simplifiedSongs = songs.map(s => ({
        id: s.id || 0,
        name: s.name || s.title
    }));
    try {
        const result = await runPythonScript('preview', simplifiedSongs);
        return result;
    }
    catch (e) {
        generatorLogger.error('Preview failed', e);
        throw e;
    }
}
// 生成檔案功能
async function generateFiles(input) {
    // 🛠️ 修正：使用 process.cwd() 確保路徑正確
    const PROJECT_ROOT = process.cwd();
    // Detect output path (Local dev: ../output, Docker/Prod: ./output)
    const OUTPUT_DIR = fs.existsSync(path.join(PROJECT_ROOT, "../resources"))
        ? path.join(PROJECT_ROOT, "../output")
        : path.join(PROJECT_ROOT, "output");
    if (!fs.existsSync(OUTPUT_DIR))
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const zipPath = path.join(OUTPUT_DIR, "presentation_files.zip");
    const outputDocx = path.join(OUTPUT_DIR, "敬拜大字報.docx");
    const outputPptx = path.join(OUTPUT_DIR, "敬拜PPT.pptx");
    try {
        // Python 腳本會接收 RESOURCES_DIR 並透過其內部的 find_ppt_path 遞迴搜尋
        await runPythonScript('generate', input, OUTPUT_DIR);
        // 開始打包 ZIP
        const output = fs.createWriteStream(zipPath);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
        return new Promise((resolve, reject) => {
            output.on('close', () => {
                generatorLogger.info(`Zip created: ${archive.pointer()} total bytes`);
                resolve(zipPath);
            });
            archive.on('error', (err) => reject(err));
            archive.pipe(output);
            if (fs.existsSync(outputDocx)) {
                archive.file(outputDocx, { name: '敬拜大字報.docx' });
            }
            else {
                generatorLogger.warn('Word file not found after Python execution');
            }
            if (fs.existsSync(outputPptx)) {
                archive.file(outputPptx, { name: '敬拜PPT.pptx' });
            }
            else {
                generatorLogger.warn('PPT file not found after Python execution');
            }
            archive.finalize();
        });
    }
    catch (e) {
        generatorLogger.error('Generate failed', e);
        throw e;
    }
}
