const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://api.iamhc.cn/v1/chat/completions';
const API_KEY = 'sk-7LRggVLwgm5A7aai7tJPllYtd6lXrTY4PSfqF6feGd0YCELP';

app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
  const { model, messages, temperature = 0.7, max_tokens = 8192 } = req.body;
  if (!model || !messages) return res.status(400).json({ error: '缺少必要参数' });

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens })
    });
    if (!response.ok) return res.status(response.status).json({ error: `上游 API 错误` });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 禁用 Nagle 算法，确保立即发送
    if (res.socket) res.socket.setNoDelay(true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            res.write(line + '\n');
            // 强制立即发送
            if (res.socket && res.socket.writable) res.socket.uncork();
          }
        }
      }
      if (buffer.trim()) res.write(buffer + '\n');
    } catch (e) {
      console.error('流中断:', e);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: `请求失败: ${err.message}` });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

app.listen(PORT, () => console.log(`🚀 服务已启动: http://localhost:${PORT}`));