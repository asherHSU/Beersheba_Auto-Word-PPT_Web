import React, { useState } from 'react';
import { Box, TextField, Button, Alert, CircularProgress } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import { apiUrl } from '../viteApiBase';

interface LoginProps {
  // ✨ 修改介面：允許回傳 role
  onLoginSuccess: (token: string, role?: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(apiUrl('/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      
      if (response.ok && data.token) {
        // ✨ 將 role 傳遞給 App.tsx
        onLoginSuccess(data.token, data.role);
      } else {
        setMessage({ type: 'error', text: data.message || '登入失敗，請檢查帳號密碼。' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '無法連接伺服器，請稍後再試。' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      
      <TextField
        label="帳號"
        variant="outlined"
        fullWidth
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <TextField
        label="密碼"
        type="password"
        variant="outlined"
        fullWidth
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      
      <Button 
        type="submit" 
        variant="contained" 
        size="large" 
        fullWidth 
        startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}
        disabled={loading}
      >
        {loading ? '登入中...' : '登入'}
      </Button>

      {message && (
        <Alert severity={message.type} sx={{ mt: 1 }}>
          {message.text}
        </Alert>
      )}
    </Box>
  );
};

export default Login;