import React, { useState, useEffect } from 'react';
import {
  Box, Button, ButtonBase, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, TextField, Pagination,
  InputAdornment, Typography, Stack, Tooltip, CircularProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import { apiUrl } from '../viteApiBase';

const authPostInit = (token: string): RequestInit => ({
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
});

interface Song {
  id: number;
  name: string;
  hasFile: boolean;
  hasScore: boolean;
}

interface SongManagerProps {
  token: string | null;
}

const SongManager: React.FC<SongManagerProps> = ({ token }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingSongList, setRefreshingSongList] = useState(false);
  const [refreshHint, setRefreshHint] = useState<string | null>(null);

  const [limit] = useState(100);

  const downloadBase = apiUrl('/songs');

  const fetchSongs = async () => {
    try {
      const query = `?page=${page}&limit=${limit}&name=${encodeURIComponent(searchTerm)}`;
      const response = await fetch(`${downloadBase}${query}`);
      const data = await response.json();
      if (response.ok) {
        setSongs(data.data);
        setTotalPages(data.pagination.totalPages);
      }
    } catch (error) {
      console.error('Fetch error:', error);
    }
  };

  useEffect(() => {
    fetchSongs();
  }, [page, searchTerm, limit]);

  const handleRefreshLibrary = async () => {
    if (!token) return;
    setRefreshing(true);
    setRefreshHint(null);
    try {
      const res = await fetch(apiUrl('/library/refresh-cache'), authPostInit(token));
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRefreshHint(typeof data.message === 'string' ? data.message : '已更新');
        await fetchSongs();
      } else {
        setRefreshHint(data.message || `更新失敗 (${res.status})`);
      }
    } catch {
      setRefreshHint('網路錯誤，請稍後再試');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefreshSongList = async () => {
    if (!token) return;
    setRefreshingSongList(true);
    setRefreshHint(null);
    try {
      const res = await fetch(apiUrl('/songs/reload-source'), authPostInit(token));
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRefreshHint(typeof data.message === 'string' ? data.message : '歌單已重新載入');
        await fetchSongs();
      } else {
        setRefreshHint(data.message || `歌單刷新失敗 (${res.status})`);
      }
    } catch {
      setRefreshHint('網路錯誤，請稍後再試');
    } finally {
      setRefreshingSongList(false);
    }
  };

  /** 與最初欄寬一致（約 120px）；可下載時整顆橢圓為連結按鈕 */
  const FILE_PILL_WIDTH = 80;

  const fileStatusPill = (ok: boolean, downloadHref: string | null, tooltip: string) => {
    const showDownload = ok && !!downloadHref;

    const pillAppearance = (theme: Theme) => ({
      width: FILE_PILL_WIDTH,
      mx: 'auto',
      minHeight: 30,
      px: 0.75,
      py: 0.5,
      borderRadius: '999px',
      border: '1px solid',
      borderColor: ok ? theme.palette.success.main : theme.palette.error.main,
      bgcolor: ok
        ? alpha(theme.palette.success.main, 0.08)
        : alpha(theme.palette.error.main, 0.08),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.35,
      boxSizing: 'border-box' as const,
    });

    const inner = (
      <>
        {ok ? (
          <CheckCircleIcon color="success" sx={{ fontSize: 14 }} />
        ) : (
          <ErrorIcon color="error" sx={{ fontSize: 14 }} />
        )}
        <Typography
          component="span"
          variant="body2"
          sx={{ fontWeight: 600, fontSize: '0.7rem', lineHeight: 1.2 }}
        >
          {ok ? '正常' : '缺檔'}
        </Typography>
        {showDownload ? (
          <DownloadIcon color="primary" sx={{ fontSize: 14, flexShrink: 0 }} />
        ) : null}
      </>
    );

    if (showDownload && downloadHref) {
      return (
        <Tooltip title={tooltip}>
          <ButtonBase
            component="a"
            href={downloadHref}
            download
            aria-label={tooltip}
            sx={(theme) => ({
              ...pillAppearance(theme),
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
              transition: theme.transitions.create(['background-color', 'box-shadow'], {
                duration: theme.transitions.duration.short,
              }),
              '&:hover': {
                bgcolor: alpha(theme.palette.success.main, 0.18),
              },
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 2,
              },
            })}
          >
            {inner}
          </ButtonBase>
        </Tooltip>
      );
    }

    return (
      <Box
        sx={(theme) => ({
          ...pillAppearance(theme),
          cursor: 'default',
        })}
      >
        {inner}
      </Box>
    );
  };

  const fileCellSx = {
    verticalAlign: 'middle' as const,
    textAlign: 'center' as const,
    px: 0.5,
    minWidth: FILE_PILL_WIDTH + 8,
  };

  return (
    <Box>
      <Stack spacing={1} mb={3}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField
            fullWidth
            variant="outlined"
            placeholder="搜尋歌名或編號..."
            size="small"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />
          <Tooltip title={token ? '重新掃描投影片與歌譜資料夾（略過快取等待時間）' : '請先登入'}>
            <span>
              <Button
                variant="outlined"
                size="medium"
                startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                onClick={handleRefreshLibrary}
                disabled={!token || refreshing || refreshingSongList}
                sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                更新檔案狀態
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={token ? '從歌單檔（xlsx/json）重新讀取清單，與「更新檔案狀態」不同' : '請先登入'}>
            <span>
              <Button
                variant="outlined"
                size="medium"
                color="secondary"
                startIcon={refreshingSongList ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                onClick={handleRefreshSongList}
                disabled={!token || refreshing || refreshingSongList}
                sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                重新載入歌單
              </Button>
            </span>
          </Tooltip>
        </Stack>
        {refreshHint ? (
          <Typography variant="caption" color={refreshHint.includes('失敗') || refreshHint.includes('錯誤') ? 'error' : 'text.secondary'}>
            {refreshHint}
          </Typography>
        ) : null}
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table sx={{ minWidth: 720 }} aria-label="song table">
          <TableHead sx={{ backgroundColor: '#f5f5f5' }}>
            <TableRow>
              <TableCell width={72} align="center">
                ID
              </TableCell>
              <TableCell>歌名</TableCell>
              <TableCell width={120} align="center" sx={{ whiteSpace: 'nowrap' }}>
                投影片
              </TableCell>
              <TableCell width={120} align="center" sx={{ whiteSpace: 'nowrap' }}>
                歌譜檔
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {songs.map((song) => (
              <TableRow key={song.id} hover>
                <TableCell align="center">{song.id}</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{song.name}</TableCell>
                <TableCell sx={fileCellSx}>
                  {fileStatusPill(
                    song.hasFile,
                    song.hasFile ? `${downloadBase}/${song.id}/download?type=ppt` : null,
                    '下載投影片'
                  )}
                </TableCell>
                <TableCell sx={fileCellSx}>
                  {fileStatusPill(
                    song.hasScore,
                    song.hasScore ? `${downloadBase}/${song.id}/download?type=score` : null,
                    '下載歌譜檔'
                  )}
                </TableCell>
              </TableRow>
            ))}
            {songs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 3 }}>
                  <Typography color="text.secondary">沒有找到相關詩歌</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
        <Pagination
          count={totalPages}
          page={page}
          onChange={(_, v) => setPage(v)}
          color="primary"
          showFirstButton
          showLastButton
          sx={{
            '& li': {
              backgroundColor: 'transparent !important',
              padding: '0 !important',
              margin: '0 !important',
              border: 'none !important',
              borderRadius: '0 !important',
              display: 'block !important',
            },
          }}
        />
      </Box>
    </Box>
  );
};

export default SongManager;
