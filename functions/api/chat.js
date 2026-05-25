// cloud-functions/api/chat.js - 流式透传修复版
const API_URL = 'https://api.iamhc.cn/v1/chat/completions';
const API_KEY = 'sk-7LRggVLwgm5A7aai7tJPllYtd6lXrTY4PSfqF6feGd0YCELP';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  try {
    const body = await request.json();
    const { model, messages, temperature = 0.7, max_tokens = 8192 } = body;
    if (!model || !messages) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const apiKey = env?.API_KEY || API_KEY;
    const apiUrl = env?.API_URL || API_URL;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens })
    });
    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `上游错误: ${errText}` }), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    }
    // 直接透传，不干扰 ReadableStream
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
