import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

/** Docker 內 cwd=/app 時 ../.env 會變成 /.env，勿當成專案根目錄 */
function isFilesystemRootDotenv(envPath: string): boolean {
    const n = path.normalize(path.resolve(envPath));
    return path.dirname(n) === path.parse(n).root;
}

const cwdEnv = path.resolve(process.cwd(), '.env');
const parentEnv = path.resolve(process.cwd(), '..', '.env');

if (fs.existsSync(parentEnv) && !isFilesystemRootDotenv(parentEnv)) {
    dotenv.config({ path: parentEnv });
} else if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
}

const backendEnv = path.resolve(process.cwd(), '.env');
if (fs.existsSync(backendEnv)) {
    // Docker 內由 compose 注入 PPT_/SCORE_ 路徑時，勿被 backend/.env 覆蓋成 Windows 磁碟路徑
    dotenv.config({ path: backendEnv, override: process.env.DOCKER !== '1' });
}

import express, { type Request, Response, NextFunction } from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import cors from 'cors'; 
import morgan from 'morgan';
import { generateFiles, extractSongData, findPptPath, findScorePath, clearFileCache } from './generator';
import { loadSongRecordsFromFile, getSongListPage, resolveSongListFilePath, clearSongFileCache } from './song-list';
import winston from 'winston';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const port = 3000;

const PROJECT_ROOT = process.cwd();
// Detect resources path (Local dev: ../resources, Docker/Prod: ./resources)
const resourcesRoot = fs.existsSync(path.join(PROJECT_ROOT, "../resources")) 
    ? path.join(PROJECT_ROOT, "../resources") 
    : path.join(PROJECT_ROOT, "resources");

const PPT_LIBRARY_PATH = process.env.PPT_LIBRARY_PATH
    ? path.resolve(process.env.PPT_LIBRARY_PATH)
    : path.join(resourcesRoot, "ppt_library");

// 確保目錄存在（Docker 掛載 /app/cloud 時勿在容器內自建子資料夾，否則會蓋住空目錄、雲端檔案永遠看不到）
if (!fs.existsSync(PPT_LIBRARY_PATH)) {
    const skipMkdir = process.env.DOCKER === '1' && PPT_LIBRARY_PATH.startsWith('/app/cloud');
    if (skipMkdir) {
        console.warn(
            `⚠️ Docker: PPT 路徑不存在（請在專案根 .env 設定 SONGS_CLOUD_ROOT=你的雲端資料夾，與 Z 槽同層）: ${PPT_LIBRARY_PATH}`
        );
    } else {
        console.log(`Creating directory: ${PPT_LIBRARY_PATH}`);
        fs.mkdirSync(PPT_LIBRARY_PATH, { recursive: true });
    }
}

/** 遞迴檢查是否至少有一個歌譜檔（PDF / JPG / PNG；略過空資料夾） */
function directoryContainsAnyScoreFile(rootDir: string, depth = 0): boolean {
    if (depth > 30) return false;
    const scoreExt = (n: string) => {
        const e = n.toLowerCase();
        return e.endsWith('.pdf') || e.endsWith('.jpg') || e.endsWith('.jpeg') || e.endsWith('.png');
    };
    try {
        const names = fs.readdirSync(rootDir);
        for (const name of names) {
            const full = path.join(rootDir, name);
            const st = fs.statSync(full);
            if (st.isFile() && scoreExt(name)) return true;
            if (st.isDirectory() && directoryContainsAnyScoreFile(full, depth + 1)) return true;
        }
    } catch {
        return false;
    }
    return false;
}

/** 歌譜 PDF 根目錄：優先 SCORE_LIBRARY_PATH，其次與投影片同層之「雲端詩歌譜」資料夾，再試詩歌清單同層 */
function resolveScoreLibraryPath(): string | null {
    const tryDir = (p: string): string | null => {
        const resolved = path.resolve(p);
        try {
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                return resolved;
            }
        } catch {
            return null;
        }
        return null;
    };

    const seen = new Set<string>();
    const ordered: string[] = [];

    const push = (p: string) => {
        const r = path.resolve(p.trim());
        if (seen.has(r)) return;
        seen.add(r);
        ordered.push(r);
    };

    const env = process.env.SCORE_LIBRARY_PATH?.trim();
    if (env) {
        const fromEnv = tryDir(env);
        if (fromEnv) {
            // 明確指定時直接使用（歌譜常在 401-500 等子資料夾，根目錄不一定有檔案）
            console.log(`📂 歌譜目錄: ${fromEnv} (SCORE_LIBRARY_PATH)`);
            return fromEnv;
        }
        console.warn(
            `⚠️ SCORE_LIBRARY_PATH 指向的目錄不存在: ${path.resolve(env)}（請確認掛載內含「2025 別是巴聖教會雲端詩歌譜」；舊版資料夾名可能為「2025 別是巴教會雲端詩歌譜」）`
        );
        push(env);
    }

    push(path.join(PPT_LIBRARY_PATH, '2025 別是巴教會雲端詩歌譜'));
    push(path.join(PPT_LIBRARY_PATH, '2025 別是巴聖教會雲端詩歌譜'));

    try {
        const songFile = resolveSongListFilePath();
        const parent = path.dirname(songFile);
        push(path.join(parent, '2025 別是巴教會雲端詩歌譜'));
        push(path.join(parent, '2025 別是巴聖教會雲端詩歌譜'));
    } catch {
        // ignore
    }

    for (const c of ordered) {
        const found = tryDir(c);
        if (!found) continue;
        if (directoryContainsAnyScoreFile(found)) {
            console.log(`📂 歌譜目錄: ${found}`);
            return found;
        }
        console.warn(`⚠️ 路徑存在但底下沒有任何 PDF/JPG/PNG，改試下一候選: ${found}`);
    }

    if (env) {
        console.warn(`⚠️ 無法解析有效歌譜目錄（曾試 SCORE_LIBRARY_PATH: ${path.resolve(env)}）`);
    } else {
        console.warn('⚠️ 找不到含 PDF/JPG/PNG 的歌譜根目錄（請設定 SCORE_LIBRARY_PATH 或確認與投影片同層有歌譜資料夾）');
    }
    return null;
}

const SCORE_LIBRARY_PATH = resolveScoreLibraryPath();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, PPT_LIBRARY_PATH)
  },
  filename: function (req, file, cb) {
    // 解決中文檔名編碼問題
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

app.use(cors()); 
app.use(morgan('dev')); 
app.use(express.json({ limit: '50mb' })); 

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'song_presentation';
const USERS_COLLECTION_NAME = 'users';
/** 設為 1 時不連 Mongo（登入與帳號 API 不可用）。詩歌清單改為檔案，與 Mongo 無關 */
const SKIP_MONGO = process.env.SKIP_MONGO === '1' || process.env.SKIP_MONGO === 'true';
let dbClient: MongoClient | undefined;

// ✨ 自動初始化超級管理員 (若資料庫無使用者)
async function initSuperAdmin() {
    if (!dbClient) return;
    const db = dbClient.db(DB_NAME);
    const usersCollection = db.collection(USERS_COLLECTION_NAME);
    
    const count = await usersCollection.countDocuments();
    if (count === 0) {
        const defaultPassword = "admin"; // ⚠️ 預設密碼，建議首次登入後修改
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        await usersCollection.insertOne({
            username: "admin",
            password: hashedPassword,
            role: "super_admin", // ✨ 最高權限標記
            createdAt: new Date()
        });
        logger.info(`✨ Initialized default Super Admin. User: 'admin', Pass: '${defaultPassword}'`);
    }
}

async function connectToMongo() {
  try {
    dbClient = new MongoClient(MONGO_URI);
    await dbClient.connect();
    logger.info('Connected to MongoDB');
    await initSuperAdmin(); 
  } catch (error) {
    logger.error('Failed to connect to MongoDB', error);
  }
}
if (SKIP_MONGO) {
    logger.warn('SKIP_MONGO=1: MongoDB disabled; login / user APIs unavailable.');
} else {
    connectToMongo();
}

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

// 身份驗證 Middleware
const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user as { id: string; role: string };
    next();
  });
};

// ✨ 權限驗證 Middleware：僅限超級管理員
const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'super_admin') {
        return res.status(403).json({ message: 'Permission denied: Super Admin only' });
    }
    next();
};

// --- Auth Routes ---

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (SKIP_MONGO || !dbClient) return res.status(503).json({ message: 'Database not connected' });
  
  const db = dbClient.db(DB_NAME);
  const user = await db.collection(USERS_COLLECTION_NAME).findOne({ username });
  
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }
  
  // 將 role 寫入 token
  const token = jwt.sign(
      { id: user._id, role: user.role || 'admin' }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
  );
  
  res.json({ token, username: user.username, role: user.role || 'admin' });
});

// ❌ 移除公開註冊接口 (/api/register)

// --- User Management Routes (Protected) ---

// 1. 獲取所有使用者列表
app.get('/api/users', authenticateToken, requireSuperAdmin, async (req, res) => {
    if (!dbClient) return res.status(503).json({ message: 'Database not connected' });
    const db = dbClient.db(DB_NAME);
    const users = await db.collection(USERS_COLLECTION_NAME)
        .find({}, { projection: { password: 0 } }) // 不回傳密碼hash
        .toArray();
    res.json(users);
});

// 2. 新增使用者 (由 Super Admin 操作)
app.post('/api/users', authenticateToken, requireSuperAdmin, async (req, res) => {
    if (!dbClient) return res.status(503).json({ message: 'Database not connected' });
    const { username, password, role } = req.body;
    const db = dbClient.db(DB_NAME);
    
    // 檢查帳號是否重複
    const existing = await db.collection(USERS_COLLECTION_NAME).findOne({ username });
    if(existing) return res.status(409).json({ message: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.collection(USERS_COLLECTION_NAME).insertOne({
        username,
        password: hashedPassword,
        role: role || 'admin', // 預設一般管理員
        createdAt: new Date()
    });
    res.json({ message: 'User created successfully' });
});

// 3. 修改使用者 (密碼或權限)
app.put('/api/users/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
    if (!dbClient) return res.status(503).json({ message: 'Database not connected' });
    const { id } = req.params;
    const { password, role } = req.body;
    const db = dbClient.db(DB_NAME);

    const updateData: any = {};
    if (role) updateData.role = role;
    if (password && password.trim() !== "") {
        updateData.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) return res.json({ message: 'Nothing to update' });

    await db.collection(USERS_COLLECTION_NAME).updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
    );
    res.json({ message: 'User updated successfully' });
});

// 4. 刪除使用者
app.delete('/api/users/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
    if (!dbClient) return res.status(503).json({ message: 'Database not connected' });
    const { id } = req.params;
    // 防止刪除自己
    // @ts-ignore
    if (req.user?.id === id) {
        return res.status(400).json({ message: 'Cannot delete yourself' });
    }

    const db = dbClient.db(DB_NAME);
    await db.collection(USERS_COLLECTION_NAME).deleteOne({ _id: new ObjectId(id) });
    res.json({ message: 'User deleted' });
});

// --- Song & File Routes ---

const MAX_SONGS_LIST_LIMIT = 50_000;

function parseSkipFileStatus(req: Request): boolean {
  const q = req.query as Record<string, unknown>;
  const v = q.skipFileStatus ?? q.light;
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

// 1. Get Songs（僅從本機檔案讀取；Mongo 只存帳號，不存詩歌列表）
app.get('/api/songs', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const rawLimit = parseInt(req.query.limit as string) || 20;
    const limit = Math.min(Math.max(1, rawLimit), MAX_SONGS_LIST_LIMIT);
    const name = req.query.name as string;
    const skipFileStatus = parseSkipFileStatus(req);

    const all = loadSongRecordsFromFile();
    const { slice, total, totalPages } = getSongListPage(all, page, limit, name);

    if (skipFileStatus) {
      const data = slice.map((song) => ({ id: song.id, name: song.name }));
      return res.json({
        data,
        pagination: {
          total,
          page,
          limit,
          totalPages,
        },
      });
    }

    const songsWithStatus = await Promise.all(
        slice.map(async (song) => {
            const filePath = await findPptPath(PPT_LIBRARY_PATH, song);
            let hasScore = false;
            if (SCORE_LIBRARY_PATH && fs.existsSync(SCORE_LIBRARY_PATH)) {
                const scorePath = await findScorePath(SCORE_LIBRARY_PATH, song);
                hasScore = !!scorePath;
            }
            return { ...song, hasFile: !!filePath, hasScore };
        })
    );
    return res.json({
        data: songsWithStatus,
        pagination: {
            total,
            page,
            limit,
            totalPages,
        },
    });
  } catch (error) {
    logger.error(error);
    const msg = error instanceof Error ? error.message : 'Error fetching songs';
    res.status(500).json({
      message: msg.includes('Song list file not found')
        ? `${msg}（Docker 請在專案根 .env 設定 SONGS_CLOUD_ROOT，並確認掛載內含歌單 xlsx）`
        : msg,
    });
  }
});

// 下載單首詩歌檔案（投影片 ppt/pptx 或歌譜 pdf/jpg/png）
app.get('/api/songs/:id/download', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid song id' });
    }
    const typeRaw = String(req.query.type || 'ppt').toLowerCase();
    const isScore = typeRaw === 'score' || typeRaw === '歌譜';

    const all = loadSongRecordsFromFile();
    const song = all.find((s) => s.id === id);
    if (!song) {
      return res.status(404).json({ message: 'Song not found' });
    }

    let filePath: string | null = null;
    if (isScore) {
      if (!SCORE_LIBRARY_PATH || !fs.existsSync(SCORE_LIBRARY_PATH)) {
        return res.status(404).json({ message: 'Score library not available' });
      }
      filePath = await findScorePath(SCORE_LIBRARY_PATH, song);
    } else {
      filePath = await findPptPath(PPT_LIBRARY_PATH, song);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found' });
    }

    const basename = path.basename(filePath);
    res.download(filePath, basename, (err) => {
      if (err) {
        logger.error(err);
        if (!res.headersSent) res.status(500).end();
      }
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: 'Download failed' });
  }
});

app.post('/api/preview', async (req, res) => {
    const { songs } = req.body;
    if (!songs || !Array.isArray(songs)) return res.status(400).json({ message: 'Invalid input' });

    try {
        const data = await extractSongData(songs, PPT_LIBRARY_PATH);
        res.json(data);
    } catch (e) {
        res.status(500).json({ message: 'Preview failed' });
    }
});

app.post('/api/generate', async (req, res) => {
    const { songs, songData } = req.body; 
    try {
        let input = songData || songs;
        if (!input || !Array.isArray(input) || input.length === 0) {
             return res.status(400).json({ message: 'Missing songs data' });
        }

        const zipPath = await generateFiles(input);
        res.download(zipPath, '敬拜資源.zip', (err) => {
            if (!err && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Generation failed' });
    }
});

app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    logger.info(`File uploaded: ${req.file.originalname}`);
    clearFileCache();
    res.json({ message: 'File uploaded successfully', filename: req.file.originalname });
});

/** 手動清除 PPT／歌譜掃描快取，下次讀取列表會重新偵測檔案（與上傳後自動清除相同） */
app.post('/api/library/refresh-cache', authenticateToken, (_req, res) => {
    try {
        clearFileCache();
        logger.info('Library cache manually refreshed (PPT + score)');
        res.json({ message: '已更新檔案掃描（投影片與歌譜），請重新整理列表。' });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Failed to refresh cache' });
    }
});

/** 重新讀取歌單檔（xlsx/json），與「更新檔案狀態」分開；試算表同步後若內容已變可手動觸發 */
const songListFileRefreshHandler = (_req: Request, res: Response) => {
    try {
        clearSongFileCache();
        logger.info('Song list file cache cleared (reload on next /api/songs)');
        res.json({ message: '已重新載入歌單來源，請重新整理列表。' });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Failed to refresh song list' });
    }
};
app.post('/api/library/refresh-songs', authenticateToken, songListFileRefreshHandler);
/** 與 refresh-songs 相同；若舊版代理只轉發 /api/songs 下路由可改用此路徑 */
app.post('/api/songs/reload-source', authenticateToken, songListFileRefreshHandler);

// 詩歌清單僅來自檔案／試算表同步，不提供 API 寫入（請改 Google 試算表或 JSON 檔）
app.post('/api/songs', authenticateToken, async (req, res) => {
    return res.status(503).json({
        message: 'Song list is file-based only. Edit the spreadsheet or SONGS_FILE_PATH source, not the API.',
    });
});

app.put('/api/songs/:id', authenticateToken, async (req, res) => {
    return res.status(503).json({
        message: 'Song list is file-based only. Edit the spreadsheet or SONGS_FILE_PATH source, not the API.',
    });
});

app.delete('/api/songs/:id', authenticateToken, async (req, res) => {
    return res.status(503).json({
        message: 'Song list is file-based only. Edit the spreadsheet or SONGS_FILE_PATH source, not the API.',
    });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`PPT library (hasFile 掃描路徑): ${PPT_LIBRARY_PATH}`);
  if (SCORE_LIBRARY_PATH) {
    console.log(`Score library (hasScore 掃描路徑): ${SCORE_LIBRARY_PATH}`);
  } else if (process.env.SCORE_LIBRARY_PATH?.trim()) {
    console.log(
      `Score library: (歌譜根目錄解析失敗，環境變數為 ${process.env.SCORE_LIBRARY_PATH}，請檢查 SONGS_CLOUD_ROOT 掛載)`
    );
  } else {
    console.log('Score library: (未設定 SCORE_LIBRARY_PATH，歌譜狀態一律為缺檔)');
  }
});