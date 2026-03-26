import express, { Request, Response, NextFunction } from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import multer from 'multer';
import cors from 'cors'; 
import morgan from 'morgan';
import { generateFiles, extractSongData, findPptPath, clearFileCache } from './generator';
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

const PPT_LIBRARY_PATH = path.join(resourcesRoot, "ppt_library");

// 確保目錄存在
if (!fs.existsSync(PPT_LIBRARY_PATH)) {
    console.log(`Creating directory: ${PPT_LIBRARY_PATH}`);
    fs.mkdirSync(PPT_LIBRARY_PATH, { recursive: true });
}

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
const COLLECTION_NAME = 'songs';
const USERS_COLLECTION_NAME = 'users';
let dbClient: MongoClient;

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
connectToMongo();

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
  if (!dbClient) return res.status(500).json({ message: 'Database not connected' });
  
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
    const db = dbClient.db(DB_NAME);
    const users = await db.collection(USERS_COLLECTION_NAME)
        .find({}, { projection: { password: 0 } }) // 不回傳密碼hash
        .toArray();
    res.json(users);
});

// 2. 新增使用者 (由 Super Admin 操作)
app.post('/api/users', authenticateToken, requireSuperAdmin, async (req, res) => {
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

// 1. Get Songs
app.get('/api/songs', async (req, res) => {
  try {
    if (!dbClient) return res.status(500).json({ message: 'Database not connected' });
    
    const db = dbClient.db(DB_NAME);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const name = req.query.name as string;

    let query: any = {};
    
    if (name) {
        query.name = { $regex: name, $options: 'i' };
        
        const total = await db.collection(COLLECTION_NAME).countDocuments(query);
        const songs = await db.collection(COLLECTION_NAME)
          .find(query)
          .sort({ id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();

        // 檢查檔案是否存在
        const songsWithStatus = await Promise.all(songs.map(async (song) => {
            // @ts-ignore
            const filePath = await findPptPath(PPT_LIBRARY_PATH, song);
            return { ...song, hasFile: !!filePath };
        }));

        return res.json({
            data: songsWithStatus,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });

    } else {
        // 預設列出 ID 範圍，效能較佳
        const startId = (page - 1) * limit + 1;
        const endId = page * limit;
        query.id = { $gte: startId, $lte: endId };

        const songs = await db.collection(COLLECTION_NAME)
          .find(query)
          .sort({ id: 1 })
          .toArray();

        const totalDocs = await db.collection(COLLECTION_NAME).countDocuments({}); 
        // 這裡假設 maxId 約等於 totalDocs，用於計算總頁數的近似值
        const lastSong = await db.collection(COLLECTION_NAME).find().sort({ id: -1 }).limit(1).toArray();
        const maxId = lastSong[0]?.id || totalDocs;

        const songsWithStatus = await Promise.all(songs.map(async (song) => {
            // @ts-ignore
            const filePath = await findPptPath(PPT_LIBRARY_PATH, song);
            return { ...song, hasFile: !!filePath };
        }));

        res.json({
            data: songsWithStatus,
            pagination: {
                total: totalDocs,
                page,
                limit,
                totalPages: Math.ceil(maxId / limit) 
            }
        });
    }
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: 'Error fetching songs' });
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

// CRUD Operations
app.post('/api/songs', authenticateToken, async (req, res) => {
    const db = dbClient.db(DB_NAME);
    const { name } = req.body;
    const lastSong = await db.collection(COLLECTION_NAME).find().sort({id: -1}).limit(1).toArray();
    const newId = (lastSong[0]?.id || 0) + 1;
    await db.collection(COLLECTION_NAME).insertOne({ id: newId, name });
    res.json({ message: 'Song added', id: newId });
});

app.put('/api/songs/:id', authenticateToken, async (req, res) => {
    const db = dbClient.db(DB_NAME);
    const id = parseInt(req.params.id);
    const { name } = req.body;
    await db.collection(COLLECTION_NAME).updateOne({ id }, { $set: { name } });
    res.json({ message: 'Song updated' });
});

app.delete('/api/songs/:id', authenticateToken, async (req, res) => {
    const db = dbClient.db(DB_NAME);
    const id = parseInt(req.params.id);
    await db.collection(COLLECTION_NAME).deleteOne({ id });
    res.json({ message: 'Song deleted' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});