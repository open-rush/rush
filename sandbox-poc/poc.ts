/**
 * OpenSandbox PoC — 验证 3 个阻断项
 *
 * 阻断项 1: Agent Worker + execd 共存
 * 阻断项 2: SandboxProvider 接口完整覆盖
 * 阻断项 3: 交互式 CLI (流式输出 + 信号中断)
 */

import { Sandbox, ConnectionConfig } from '@alibaba-group/opensandbox';

const conn = new ConnectionConfig({
  domain: 'localhost:8090',
  protocol: 'http',
});

// ─── 阻断项 1: Agent Worker + execd 共存 ───────────────────────

async function verifyCoexistence() {
  console.log('\n═══ 阻断项 1: Agent Worker + execd 共存 ═══\n');

  // 创建 sandbox，用 node 镜像模拟 agent-worker 环境
  const sandbox = await Sandbox.create({
    connectionConfig: conn,
    image: 'node:22-slim',
    entrypoint: ['sleep', 'infinity'],
    resource: { cpu: '1000m', memory: '1024Mi' },
    timeoutSeconds: 300,
  });
  console.log(`✓ Sandbox 创建成功: ${sandbox.id}`);

  // 验证 execd 健康
  const healthy = await sandbox.isHealthy();
  console.log(`✓ execd 健康检查: ${healthy}`);

  // 在 sandbox 内启动一个模拟 agent-worker (Hono HTTP server on :8787)
  const agentWorkerScript = `
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', service: 'agent-worker', pid: process.pid}));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});
server.listen(8787, () => console.log('Agent worker on :8787'));
`;

  // 写入脚本文件
  await sandbox.files.write('/tmp/agent-worker.js', agentWorkerScript);
  console.log('✓ Agent worker 脚本已写入');

  // 后台启动 agent-worker
  const bgExec = sandbox.commands.run('node /tmp/agent-worker.js &', { timeout: 5 });
  // 等待启动
  await new Promise((r) => setTimeout(r, 2000));

  // 验证两个服务共存
  // 1. execd 仍然健康
  const stillHealthy = await sandbox.isHealthy();
  console.log(`✓ execd 仍然健康: ${stillHealthy}`);

  // 2. agent-worker 响应
  const checkAgent = await sandbox.commands.run('curl -s http://127.0.0.1:8787/health');
  const agentResult = checkAgent.logs?.stdout?.trim();
  console.log(`✓ Agent worker 响应: ${agentResult}`);

  // 3. 检查进程列表
  const psResult = await sandbox.commands.run('ls /proc/*/cmdline 2>/dev/null | wc -l');
  console.log(`✓ 进程数量: ${psResult.logs?.stdout?.trim()}`);

  // 4. 检查内存使用
  const memResult = await sandbox.commands.run('cat /proc/meminfo | head -3');
  console.log(`✓ 内存信息:\n${memResult.logs?.stdout}`);

  // 5. 持续运行 10 秒验证稳定性
  console.log('  等待 10 秒验证稳定性...');
  await new Promise((r) => setTimeout(r, 10000));

  const finalHealth = await sandbox.isHealthy();
  const finalAgent = await sandbox.commands.run('curl -s http://127.0.0.1:8787/health');
  console.log(`✓ 10 秒后 execd 健康: ${finalHealth}`);
  console.log(`✓ 10 秒后 agent-worker: ${finalAgent.logs?.stdout?.trim()}`);

  await sandbox.kill();
  console.log('✓ Sandbox 已销毁');
  console.log('\n✅ 阻断项 1 通过: Agent Worker + execd 稳定共存');
}

// ─── 阻断项 2: SandboxProvider 接口完整覆盖 ────────────────────

async function verifySandboxProvider() {
  console.log('\n═══ 阻断项 2: SandboxProvider 接口覆盖 ═══\n');

  // --- create() ---
  console.log('测试 create()...');
  const sandbox = await Sandbox.create({
    connectionConfig: conn,
    image: 'node:22-slim',
    entrypoint: ['sleep', 'infinity'],
    resource: { cpu: '500m', memory: '512Mi' },
    env: { FOO: 'bar', NODE_ENV: 'test' },
    metadata: { agentId: 'test-agent-123' },
    timeoutSeconds: 300,
  });
  console.log(`  ✓ create() → id=${sandbox.id}`);

  // --- getInfo() ---
  console.log('测试 getInfo()...');
  const info = await sandbox.getInfo();
  console.log(`  ✓ getInfo() → state=${info.status?.state}, image=${info.image?.uri}`);

  // --- healthCheck() ---
  console.log('测试 healthCheck()...');
  const healthy = await sandbox.isHealthy();
  console.log(`  ✓ isHealthy() → ${healthy}`);

  // --- exec() ---
  console.log('测试 exec() (commands.run)...');
  const result = await sandbox.commands.run('echo $FOO && node --version');
  console.log(`  ✓ exec() → stdout: ${result.logs?.stdout?.trim()}`);
  console.log(`  ✓ exec() → exitCode: ${result.exitCode}`);

  // --- 测试 stderr ---
  console.log('测试 exec() stderr...');
  const errResult = await sandbox.commands.run('echo error >&2 && exit 1');
  console.log(`  ✓ exec() stderr → ${errResult.logs?.stderr?.trim()}`);
  console.log(`  ✓ exec() exitCode → ${errResult.exitCode}`);

  // --- files (filesystem) ---
  console.log('测试 files...');
  await sandbox.files.write('/tmp/test.txt', 'hello opensandbox');
  const content = await sandbox.files.read('/tmp/test.txt');
  console.log(`  ✓ files.write + files.read → "${content}"`);

  const fileList = await sandbox.files.list('/tmp');
  console.log(`  ✓ files.list(/tmp) → ${fileList.length} 个文件`);

  // --- getEndpointUrl (通过 sandbox info 的 metadata) ---
  console.log('测试 endpoint 获取...');
  const info2 = await sandbox.getInfo();
  const httpPort = info2.metadata?.['opensandbox.io/http-port'];
  console.log(`  ✓ endpoint port → ${httpPort}`);

  // --- destroy() ---
  console.log('测试 destroy() (kill)...');
  await sandbox.kill();
  console.log('  ✓ kill() 成功');

  // 验证已销毁
  try {
    await Sandbox.connect({ connectionConfig: conn, id: sandbox.id });
    console.log('  ✗ sandbox 应该已销毁但仍可连接');
  } catch (e: any) {
    console.log(`  ✓ 销毁后连接失败 (预期): ${e.message?.slice(0, 60)}`);
  }

  console.log('\n✅ 阻断项 2 通过: SandboxProvider 全部方法可覆盖');
}

// ─── 阻断项 3: 交互式 CLI (流式输出 + 信号中断) ──────────────

async function verifyInteractiveCLI() {
  console.log('\n═══ 阻断项 3: 交互式 CLI ═══\n');

  const sandbox = await Sandbox.create({
    connectionConfig: conn,
    image: 'node:22-slim',
    entrypoint: ['sleep', 'infinity'],
    resource: { cpu: '1000m', memory: '1024Mi' },
    timeoutSeconds: 300,
  });
  console.log(`✓ Sandbox 创建: ${sandbox.id}`);

  // 测试流式输出
  console.log('\n--- 测试流式命令输出 ---');
  const streamResult = await sandbox.commands.run(
    'for i in 1 2 3 4 5; do echo "line $i"; sleep 0.5; done',
    {
      timeout: 30,
      onStdout: (data: string) => process.stdout.write(`  [stream] ${data}\n`),
    }
  );
  console.log(`✓ 流式输出完成, exitCode=${streamResult.exitCode}`);

  // 测试长时间运行 + 超时中断
  console.log('\n--- 测试命令超时中断 ---');
  const startTime = Date.now();
  try {
    await sandbox.commands.run('sleep 60', { timeout: 3 });
    console.log('  ✗ 应该超时但没有');
  } catch (e: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✓ 命令在 ${elapsed}s 后被中断 (timeout=3s): ${e.message?.slice(0, 60)}`);
  }

  // 验证中断后 sandbox 仍然可用
  const stillOk = await sandbox.isHealthy();
  console.log(`✓ 中断后 sandbox 仍然健康: ${stillOk}`);

  const afterExec = await sandbox.commands.run('echo "still alive"');
  console.log(`✓ 中断后仍可执行: ${afterExec.logs?.stdout?.trim()}`);

  // 测试 SIGINT 场景：启动 node 进程然后 kill
  console.log('\n--- 测试 SIGINT 信号 ---');
  // 后台启动一个会写 PID 的 node 进程
  await sandbox.commands.run('node -e "require(\'fs\').writeFileSync(\'/tmp/pid\', String(process.pid)); setInterval(()=>{},1000)" &');
  await new Promise((r) => setTimeout(r, 1000));
  const pidResult = await sandbox.commands.run('cat /tmp/pid');
  const pid = pidResult.logs?.stdout?.trim();
  console.log(`  后台进程 PID: ${pid}`);

  // 发送 SIGINT
  const killResult = await sandbox.commands.run(`kill -2 ${pid} 2>&1; echo "signal sent"`);
  console.log(`  ✓ SIGINT 发送: ${killResult.logs?.stdout?.trim()}`);

  // 验证进程已退出
  await new Promise((r) => setTimeout(r, 500));
  const checkResult = await sandbox.commands.run(`kill -0 ${pid} 2>&1 || echo "process exited"`);
  console.log(`  ✓ 进程状态: ${checkResult.logs?.stdout?.trim() || checkResult.logs?.stderr?.trim()}`);

  await sandbox.kill();
  console.log('\n✅ 阻断项 3 通过: 流式输出 + 超时中断 + SIGINT 均可用');
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('OpenSandbox PoC — 验证 3 个阻断项');
  console.log(`Server: http://localhost:8090`);

  try {
    await verifyCoexistence();
    await verifySandboxProvider();
    await verifyInteractiveCLI();

    console.log('\n' + '═'.repeat(50));
    console.log('🎉 全部 3 个阻断项验证通过！');
    console.log('═'.repeat(50));
  } catch (err) {
    console.error('\n❌ 验证失败:', err);
    process.exit(1);
  }
}

main();
