# 產檔腳本（Python）

`generator.py` 由 Node 後端以 `python` 指令呼叫，用於預覽與產生 Word／PPT。

## 環境

- **Python**：建議 **3.10+**（與本機／伺服器一致，避免「本機可以、伺服器不行」）。
- **依賴**：見同目錄 `requirements-generator.txt`。

```bash
cd backend/scripts
python -m pip install -r requirements-generator.txt
```

Windows 若同時有 `python` 與 `py`，請與後端實際使用的指令一致（後端目前使用 `spawn('python', ...)`）。

## Docker／正式機

將上述 `pip install` 納入映像建置步驟，或將 Python 與依賴版本寫入部署文件，與開發機對齊。
