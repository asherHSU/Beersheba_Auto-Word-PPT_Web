import React, { useState, useEffect } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Button, IconButton, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, Chip, Select, MenuItem, FormControl, InputLabel,
  Alert, Stack, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SecurityIcon from '@mui/icons-material/Security';
import PersonIcon from '@mui/icons-material/Person';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import { apiUrl } from '../viteApiBase';

interface User {
  _id: string;
  username: string;
  role: 'super_admin' | 'admin';
}

interface UserManagerProps {
  token: string | null;
}

const UserManager: React.FC<UserManagerProps> = ({ token }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  // 新增/編輯的使用者狀態
  const [currentUser, setCurrentUser] = useState<Partial<User> & { password?: string }>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch(apiUrl('/users'), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (token) fetchUsers();
  }, [token]);

  const handleOpenDialog = (user?: User) => {
    if (user) {
      // 編輯模式：密碼預設留空 (不修改)
      setCurrentUser({ ...user, password: '' });
    } else {
      // 新增模式：預設一般管理員
      setCurrentUser({ role: 'admin', username: '', password: '' });
    }
    setMessage(null);
    setOpenDialog(true);
  };

  const handleSave = async () => {
    if (!token) return;
    
    if (!currentUser.username) {
        setMessage({ type: 'error', text: '帳號名稱為必填' });
        return;
    }
    // 若是新增模式，密碼為必填
    if (!currentUser._id && !currentUser.password) {
        setMessage({ type: 'error', text: '新增用戶時，密碼為必填項目' });
        return;
    }

    try {
      const url = currentUser._id 
        ? apiUrl(`/users/${currentUser._id}`) 
        : apiUrl('/users');
      
      const method = currentUser._id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(currentUser)
      });

      const data = await res.json();

      if (res.ok) {
        setOpenDialog(false);
        fetchUsers(); // 重新整理列表
      } else {
        setMessage({ type: 'error', text: data.message || '操作失敗' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: '網路連線錯誤' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('確定要刪除此帳號嗎？刪除後無法復原。')) return;
    try {
      const res = await fetch(apiUrl(`/users/${id}`), {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.message);
      }
    } catch (e) {
      alert('刪除失敗');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
            <Typography variant="h6" color="primary" fontWeight="bold">
                <SupervisorAccountIcon sx={{ verticalAlign: 'middle', mr: 1, mb: 0.5 }} />
                管理員列表
            </Typography>
            <Typography variant="body2" color="text.secondary">
                在此頁面您可以新增、修改或刪除系統管理員帳號。
            </Typography>
        </Box>
        <Button variant="contained" color="success" startIcon={<AddIcon />} onClick={() => handleOpenDialog()}>
          新增管理員
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
        <Table>
          <TableHead sx={{ bgcolor: '#f5f5f5' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>帳號名稱</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>權限層級</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold' }}>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user._id} hover>
                <TableCell>{user.username}</TableCell>
                <TableCell>
                  {user.role === 'super_admin' ? (
                    <Chip 
                        icon={<SecurityIcon />} 
                        label="超級管理員" 
                        color="secondary" 
                        size="small" 
                        sx={{ fontWeight: 'bold' }}
                    />
                  ) : (
                    <Chip 
                        icon={<PersonIcon />} 
                        label="一般管理員" 
                        color="default" 
                        size="small" 
                        variant="outlined" 
                    />
                  )}
                </TableCell>
                <TableCell align="center">
                  <IconButton color="primary" onClick={() => handleOpenDialog(user)} size="small">
                    <EditIcon />
                  </IconButton>
                  <IconButton color="error" onClick={() => handleDelete(user._id)} size="small">
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 新增/編輯 Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ borderBottom: '1px solid #eee' }}>
            {currentUser._id ? '編輯帳號' : '新增管理員'}
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              label="帳號 (Username)"
              fullWidth
              value={currentUser.username}
              disabled={!!currentUser._id} // 編輯模式不可改帳號
              onChange={(e) => setCurrentUser({...currentUser, username: e.target.value})}
              placeholder="請輸入登入帳號"
            />
            
            <Box>
                <TextField
                label={currentUser._id ? "重設密碼 (若不修改請留空)" : "密碼"}
                type="password"
                fullWidth
                value={currentUser.password}
                onChange={(e) => setCurrentUser({...currentUser, password: e.target.value})}
                placeholder={currentUser._id ? "******" : "請設定密碼"}
                />
                {currentUser._id && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        * 留空則維持原密碼
                    </Typography>
                )}
            </Box>

            <FormControl fullWidth>
              <InputLabel>權限角色</InputLabel>
              <Select
                value={currentUser.role || 'admin'}
                label="權限角色"
                onChange={(e) => setCurrentUser({...currentUser, role: e.target.value as any})}
              >
                <MenuItem value="admin">一般管理員 (僅能管理詩歌)</MenuItem>
                <MenuItem value="super_admin">超級管理員 (可管理帳號)</MenuItem>
              </Select>
            </FormControl>
            
            {message && (
              <Alert severity={message.type}>
                {message.text}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: '1px solid #eee' }}>
          <Button onClick={() => setOpenDialog(false)} color="inherit">取消</Button>
          <Button onClick={handleSave} variant="contained" disableElevation>
            確認儲存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserManager;