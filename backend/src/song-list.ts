import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';

export type SongRecord = { id: number; name: string };

/** 以檔案內容 SHA-256 判斷是否需重讀（比 mtime 可靠） */
let fileCache: { songs: SongRecord[]; contentHash: string } | null = null;

/** 預設：專案 resources/songs_db.json，或由 SONGS_FILE_PATH 指定（.json / .xlsx） */
export function resolveSongListFilePath(): string {
    if (process.env.SONGS_FILE_PATH && process.env.SONGS_FILE_PATH.trim() !== '') {
        return path.resolve(process.env.SONGS_FILE_PATH.trim());
    }
    const candidates = [
        path.join(process.cwd(), '..', 'resources', 'songs_db.json'),
        path.join(process.cwd(), 'resources', 'songs_db.json'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return path.resolve(c);
    }
    return path.resolve(candidates[0]);
}

function detectFormat(resolved: string): 'json' | 'xlsx' {
    const v = (process.env.SONGS_DATA_SOURCE || '').toLowerCase();
    if (v === 'json') return 'json';
    if (v === 'xlsx' || v === 'excel') return 'xlsx';
    if (resolved.toLowerCase().endsWith('.xlsx')) return 'xlsx';
    return 'json';
}

export function clearSongFileCache(): void {
    fileCache = null;
}

/** 僅接受純數字編號，避免「1-100」等欄被 parseInt 誤判為 1 */
function parseSongId(raw: string | number | undefined): number {
    if (raw === '' || raw === undefined || raw === null) return NaN;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw);
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) return NaN;
    return parseInt(s, 10);
}

/**
 * wide：同一列多組「編號、歌名」橫向排列（別是巴試算表格式）
 * simple：僅讀固定兩欄（預設 A=id、B=name）
 */
function parseXlsxWorkbook(wb: XLSX.WorkBook): SongRecord[] {
    const sheetIndex = Math.max(0, parseInt(process.env.SONGS_XLSX_SHEET_INDEX || '0', 10));
    const sheetName = wb.SheetNames[sheetIndex];
    if (!sheetName) return [];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
        header: 1,
        defval: '',
    }) as (string | number)[][];

    const layout = (process.env.SONGS_XLSX_LAYOUT || 'wide').toLowerCase();
    const skipRows = parseInt(process.env.SONGS_XLSX_SKIP_ROWS || '1', 10);
    const out: SongRecord[] = [];

    if (layout === 'simple') {
        const colId = parseInt(process.env.SONGS_XLSX_COL_ID || '0', 10);
        const colName = parseInt(process.env.SONGS_XLSX_COL_NAME || '1', 10);
        for (let i = skipRows; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            const rawId = row[colId];
            const rawName = row[colName];
            if (rawName === '' || rawName === undefined || rawName === null) continue;
            const id = parseSongId(rawId as string | number);
            const name = String(rawName).trim();
            if (!name || Number.isNaN(id)) continue;
            out.push({ id, name });
        }
        return out.sort((a, b) => a.id - b.id);
    }

    for (let i = skipRows; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        for (let c = 0; c + 1 < row.length; c += 2) {
            const rawId = row[c];
            const rawName = row[c + 1];
            if (rawName === '' || rawName === undefined || rawName === null) continue;
            const id = parseSongId(rawId as string | number);
            const name = String(rawName).trim();
            if (!name || Number.isNaN(id)) continue;
            out.push({ id, name });
        }
    }
    return out.sort((a, b) => a.id - b.id);
}

/** 從本機檔案讀取詩歌清單（Mongo 不儲存列表） */
export function loadSongRecordsFromFile(): SongRecord[] {
    const resolved = resolveSongListFilePath();
    if (!fs.existsSync(resolved)) {
        throw new Error(
            `Song list file not found: ${resolved}. Set SONGS_FILE_PATH or place songs_db.json under resources/.`
        );
    }
    const buf = fs.readFileSync(resolved);
    const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
    const fmt = detectFormat(resolved);

    if (fileCache && fileCache.contentHash === contentHash) {
        return fileCache.songs;
    }

    let songs: SongRecord[];
    if (fmt === 'json') {
        const raw = JSON.parse(buf.toString('utf-8')) as SongRecord[];
        songs = Array.isArray(raw) ? raw : [];
    } else {
        const wb = XLSX.read(buf, { type: 'buffer' });
        songs = parseXlsxWorkbook(wb);
    }

    fileCache = { songs, contentHash };
    return songs;
}

/**
 * 分頁：依清單排序後做 offset/limit（與試算表列順序一致）。
 * 不再用「id 落在某區間」篩選，否則編號不連續時會漏歌、總頁數也會錯。
 */
export function getSongListPage(
    all: SongRecord[],
    page: number,
    limit: number,
    name?: string
): { slice: SongRecord[]; total: number; totalPages: number; maxId: number } {
    let filtered = all;
    const q = typeof name === 'string' ? name.trim() : '';
    if (q) {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'i');
        filtered = all.filter(
            (s) => re.test(s.name) || String(s.id).includes(q)
        );
    }

    const sorted = [...filtered].sort((a, b) => a.id - b.id);
    const total = sorted.length;
    const maxId = sorted.reduce((m, s) => Math.max(m, s.id), 0);
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const slice = sorted.slice(skip, skip + limit);

    return {
        slice,
        total,
        totalPages,
        maxId,
    };
}
