/**
 * OpenSandbox PoC — 最小验证
 * 先确认 SDK 能创建 sandbox 并连接 execd
 */

import { Sandbox, ConnectionConfig } from '@alibaba-group/opensandbox';

const conn = new ConnectionConfig({
  domain: 'localhost:8090',
  protocol: 'http',
});

async function main() {
  console.log('1. 创建 sandbox (skipHealthCheck)...');
  const sandbox = await Sandbox.create({
    connectionConfig: conn,
    image: 'node:22-slim',
    entrypoint: ['sleep', 'infinity'],
    resource: { cpu: '500m', memory: '512Mi' },
    timeoutSeconds: 300,
    skipHealthCheck: true,
  });
  console.log(`   id: ${sandbox.id}`);

  console.log('2. 获取 sandbox info...');
  const info = await sandbox.getInfo();
  console.log(`   state: ${info.status?.state}`);
  console.log(`   metadata: ${JSON.stringify(info.metadata)}`);

  // 等 execd 启动
  console.log('3. 等待 execd 启动 (3s)...');
  await new Promise((r) => setTimeout(r, 3000));

  console.log('4. 尝试 isHealthy...');
  try {
    const h = await sandbox.isHealthy();
    console.log(`   healthy: ${h}`);
  } catch (e: any) {
    console.log(`   health check failed: ${e.message?.slice(0, 100)}`);
  }

  console.log('5. 尝试 commands.run...');
  try {
    const result = await sandbox.commands.run('echo hello', { timeout: 10 });
    console.log(`   stdout: ${result.logs?.stdout?.trim()}`);
    console.log(`   exitCode: ${result.exitCode}`);
  } catch (e: any) {
    console.log(`   exec failed: ${e.message?.slice(0, 200)}`);
  }

  console.log('6. 手动 curl execd via 映射端口...');
  const httpPort = info.metadata?.['opensandbox.io/http-port'];
  const embeddingPort = info.metadata?.['opensandbox.io/embedding-proxy-port'];
  console.log(`   http-port: ${httpPort}, embedding-proxy-port: ${embeddingPort}`);

  if (embeddingPort) {
    try {
      const resp = await fetch(`http://localhost:${embeddingPort}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo hello from execd' }),
      });
      const text = await resp.text();
      console.log(`   execd 直连结果: ${text.slice(0, 200)}`);
    } catch (e: any) {
      console.log(`   execd 直连失败: ${e.message}`);
    }
  }

  console.log('7. 清理...');
  await sandbox.kill();
  console.log('   done');
}

main().catch(console.error);
