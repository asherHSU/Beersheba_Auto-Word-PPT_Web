import React, { useState } from 'react';
import { Box, TextField, Button, Typography, Alert, CircularProgress } from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { apiUrl } from '../viteApiBase';

const Register: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(apiUrl('/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      
      if (response.ok) {
        setMessage({ type: 'success', text: '註冊成功！請切換至登入頁面。' });
        setUsername('');
        setPassword('');
      } else {
        setMessage({ type: 'error', text: data.message || '註冊失敗。' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '無法連接伺服器。' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleRegister} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6" align="center" gutterBottom>
        建立新管理員
      </Typography>

      <TextField
        label="新帳號"
        variant="outlined"
        fullWidth
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <TextField
        label="新密碼"
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
        color="secondary"
        size="large" 
        fullWidth 
        startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <PersonAddIcon />}
        disabled={loading}
      >
        {loading ? '註冊中...' : '註冊'}
      </Button>

      {message && (
        <Alert severity={message.type} sx={{ mt: 1 }}>
          {message.text}
        </Alert>
      )}
    </Box>
  );
};

export default Register;