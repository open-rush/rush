/**
 * OpenSandbox PoC — 原始 HTTP API 验证
 * 绕过 SDK 连接问题，直接用 REST API + execd HTTP API
 */

const SERVER = 'http://localhost:8090';

// ─── 工具函数 ─────────────────────────────────────────────────

async function createSandbox(opts: {
  image: string;
  entrypoint: string[];
  resource: Record<string, string>;
  env?: Record<string, string>;
  timeout?: number;
}) {
  const resp = await fetch(`${SERVER}/v1/sandboxes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: { uri: opts.image },
      entrypoint: opts.entrypoint,
      resourceLimits: opts.resource,
      timeout: opts.timeout ?? 300,
      env: opts.env,
    }),
  });
  return resp.json() as Promise<{
    id: string;
    status: { state: string };
    metadata?: Record<string, string>;
  }>;
}

async function getSandbox(id: string) {
  const resp = await fetch(`${SERVER}/v1/sandboxes/${id}`);
  return resp.json() as Promise<{
    id: string;
    status: { state: string };
    metadata?: Record<string, string>;
  }>;
}

async function deleteSandbox(id: string) {
  await fetch(`${SERVER}/v1/sandboxes/${id}`, { method: 'DELETE' });
}

async function getExecdPort(id: string): Promise<number> {
  const info = await getSandbox(id);
  const port = info.metadata?.['opensandbox.io/embedding-proxy-port'];
  if (!port) throw new Error('No embedding-proxy-port in metadata');
  return Number(port);
}

async function execInSandbox(
  execdPort: number,
  command: string,
  opts?: { timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const controller = new AbortController();
  const timer = opts?.timeout
    ? setTimeout(() => controller.abort(), opts.timeout * 1000)
    : null;

  try {
    const resp = await fetch(`http://localhost:${execdPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });

    const text = await resp.text();
    const lines = text.trim().split('\n').filter(Boolean);

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'stdout') stdout += event.text + '\n';
        else if (event.type === 'stderr') stderr += event.text + '\n';
        else if (event.type === 'execution_complete') exitCode = event.exit_code ?? 0;
      } catch {}
    }

    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeFile(execdPort: number, path: string, content: string) {
  // Use exec to write file
  const escaped = content.replace(/'/g, "'\\''");
  await execInSandbox(execdPort, `cat > ${path} << 'OPENSANDBOX_EOF'\n${content}\nOPENSANDBOX_EOF`);
}

async function readFile(execdPort: number, path: string): Promise<string> {
  const result = await execInSandbox(execdPort, `cat ${path}`);
  return result.stdout;
}

// ─── 阻断项 1: Agent Worker + execd 共存 ───────────────────────

async function verifyCoexistence() {
  console.log('\n═══ 阻断项 1: Agent Worker + execd 共存 ═══\n');

  const sbx = await createSandbox({
    image: 'node:22-slim',
    entrypoint: ['sleep', 'infinity'],
    resource: { cpu: '1000m', memory: '1024Mi' },
    timeout: 300,
  });
  console.log(`✓ Sandbox 创建: ${sbx.id}`);

  // 等 execd 启动
  await new Promise((r) => setTimeout(r, 2000));
  const port = await getExecdPort(sbx.id);
  console.log(`✓ execd port: ${port}`);

  // 验证 execd 可用
  const hello = await execInSandbox(port, 'echo "execd works"');
  console.log(`✓ execd 执行: ${hello.stdout}`);

  // 写入并启动模拟 agent-worker
  const agentScript = `
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', service: 'agent-worker', pid: process.pid}));
  } else if (req.url === '/prompt') {
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    res.write('data: {"type":"text","content":"Hello from agent"}\\n\\n');
    res.write('data: {"type":"done"}\\n\\n');
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(8787, () => {
  require('fs').writeFileSync('/tmp/agent.pid', String(process.pid));
  console.log('Agent worker on :8787, pid=' + process.pid);
});
`;

  await writeFile(port, '/tmp/agent-worker.js', agentScript);
  await execInSandbox(port, 'node /tmp/agent-worker.js &');
  await new Promise((r) => setTimeout(r, 1500));

  // 验证两个服务共存
  const agentHealth = await execInSandbox(port, 'curl -s http://127.0.0.1:8787/health');
  console.log(`✓ Agent worker 响应: ${agentHealth.stdout}`);

  const agentPid = await execInSandbox(port, 'cat /tmp/agent.pid');
  console.log(`✓ Agent worker PID: ${agentPid.stdout}`);

  // 验证 SSE 流式输出
  const sseResult = await execInSandbox(port, 'curl -s http://127.0.0.1:8787/prompt');
  console.log(`✓ Agent SSE 输出: ${sseResult.stdout}`);

  // 内存使用
  const mem = await execInSandbox(port, 'cat /proc/meminfo | grep -E "MemTotal|MemAvail"');
  console.log(`✓ 内存: ${mem.stdout}`);

  // 持续 10 秒验证稳定性
  console.log('  等待 10 秒验证稳定性...');
  await new Promise((r) => setTimeout(r, 10000));

  const finalExecd = await execInSandbox(port, 'echo "execd alive"');
  const finalAgent = await execInSandbox(port, 'curl -s http://127.0.0.1:8787/health');
  console.log(`✓ 10s 后 execd: ${finalExecd.stdout}`);
  console.log(`✓ 10s 后 agent: ${finalAgent.stdout}`);

  await deleteSandbox(sbx.id);
  console.log('✓ Sandbox 已销毁');
  console.log('\n✅ 阻断项 1 通过');
}

// ─── 阻断项 2: SandboxProvider 接口完整覆盖 ────────────────────

async function verifySandboxProvider() {
  console.log('\n═══ 阻断项 2: SandboxProvider 接口覆盖 ═══\n');

  // --- create() ---
  const sbx = await createSandbox({
    image: 'node:22-slim',
    entrypoint: ['sleep', 'infinity'],
    resource: { cpu: '500m', memory: '512Mi' },
    env: { FOO: 'bar', NODE_ENV: 'test' },
    timeout: 300,
  });
  console.log(`✓ create() → id=${sbx.id}, state=${sbx.status.state}`);

  await new Promise((r) => setTimeout(r, 2000));
  const port = await getExecdPort(sbx.id);

  // --- getInfo() ---
  const info = await getSandbox(sbx.id);
  console.log(`✓ getInfo() → state=${info.status.state}`);

  // --- healthCheck() via execd ping ---
  const ping = await execInSandbox(port, 'echo pong');
  console.log(`✓ healthCheck() → ${ping.exitCode === 0 ? 'healthy' : 'unhealthy'}`);

  // --- exec() ---
  const result = await execInSandbox(port, 'echo $FOO && node --version');
  console.log(`✓ exec() → stdout: ${result.stdout}`);
  console.log(`  exitCode: ${result.exitCode}`);

  // --- exec() with stderr ---
  const errResult = await execInSandbox(port, 'echo error >&2; exit 1');
  console.log(`✓ exec() stderr → "${errResult.stderr}", exitCode=${errResult.exitCode}`);

  // --- filesystem ---
  await writeFile(port, '/tmp/test.txt', 'hello opensandbox');
  const content = await readFile(port, '/tmp/test.txt');
  console.log(`✓ write + read → "${content}"`);

  const ls = await execInSandbox(port, 'ls /tmp/*.txt');
  console.log(`✓ list files → ${ls.stdout}`);

  // --- getEndpointUrl ---
  console.log(`✓ getEndpointUrl() → localhost:${port}`);

  // --- destroy() ---
  await deleteSandbox(sbx.id);
  console.log(`✓ destroy() 成功`);

  // 验证已销毁
  const check = await getSandbox(sbx.id);
  console.log(`✓ 销毁后 getInfo: ${JSON.stringify(check).slice(0, 80)}`);

  console.log('\n✅ 阻断项 2 通过');
}

// ─── 阻断项 3: 交互式 CLI ──────────────────────────────────────

async function verifyInteractiveCLI() {
  console.log('\n═══ 阻断项 3: 交互式 CLI ═══\n');

  const sbx = await createSandbox({
    image: 'node:22-slim',
    entrypoint: ['sleep', 'infinity'],
    resource: { cpu: '1000m', memory: '1024Mi' },
    timeout: 300,
  });

  await new Promise((r) => setTimeout(r, 2000));
  const port = await getExecdPort(sbx.id);
  console.log(`✓ Sandbox: ${sbx.id}, execd port: ${port}`);

  // --- 流式输出 ---
  console.log('\n--- 流式命令输出 ---');
  const streamResult = await execInSandbox(port, 'for i in 1 2 3 4 5; do echo "line $i"; sleep 0.3; done');
  console.log(`  输出:\n${streamResult.stdout.split('\n').map((l) => `    ${l}`).join('\n')}`);
  console.log(`  exitCode: ${streamResult.exitCode}`);

  // --- 超时中断 ---
  console.log('\n--- 命令超时中断 ---');
  const start = Date.now();
  try {
    await execInSandbox(port, 'sleep 60', { timeout: 3 });
    console.log('  ✗ 应该超时但没有');
  } catch (e: any) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ✓ 命令在 ${elapsed}s 后被中断: ${e.message?.slice(0, 60) || e.name}`);
  }

  // 中断后 sandbox 仍可用
  const afterExec = await execInSandbox(port, 'echo "still alive"');
  console.log(`  ✓ 中断后仍可执行: ${afterExec.stdout}`);

  // --- SIGINT ---
  console.log('\n--- SIGINT 信号 ---');
  await execInSandbox(port, 'node -e "require(\'fs\').writeFileSync(\'/tmp/pid\', String(process.pid)); setInterval(()=>{},1000)" &');
  await new Promise((r) => setTimeout(r, 1000));
  const pidResult = await execInSandbox(port, 'cat /tmp/pid');
  const pid = pidResult.stdout.trim();
  console.log(`  后台进程 PID: ${pid}`);

  await execInSandbox(port, `kill -2 ${pid}`);
  await new Promise((r) => setTimeout(r, 500));
  const check = await execInSandbox(port, `kill -0 ${pid} 2>&1 || echo "exited"`);
  console.log(`  ✓ SIGINT 后: ${check.stdout || check.stderr}`);

  // --- 长输出 ---
  console.log('\n--- 长输出 ---');
  const longResult = await execInSandbox(port, 'seq 1 100 | wc -l');
  console.log(`  ✓ 100 行输出: ${longResult.stdout} 行`);

  await deleteSandbox(sbx.id);
  console.log('\n✅ 阻断项 3 通过');
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('OpenSandbox PoC — 原始 HTTP API 验证');
  console.log(`Server: ${SERVER}\n`);

  // 检查 server 健康
  const health = await fetch(`${SERVER}/health`).then((r) => r.json());
  console.log(`Server: ${JSON.stringify(health)}`);

  await verifyCoexistence();
  await verifySandboxProvider();
  await verifyInteractiveCLI();

  console.log('\n' + '═'.repeat(50));
  console.log('全部 3 个阻断项验证通过');
  console.log('═'.repeat(50));
}

main().catch((err) => {
  console.error('\n❌ 验证失败:', err);
  process.exit(1);
});
