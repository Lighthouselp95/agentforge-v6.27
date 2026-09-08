// Test script to verify OpenCodeServeClient functionality
import { OpenCodeServeClient } from '../dist/agents/opencode-serve-client.js';

async function runTests() {
  console.log('--- 1. Testing OpenCodeServeClient.checkServeHealth ---');
  const health = await OpenCodeServeClient.checkServeHealth('http://127.0.0.1:4096');
  console.log('Health check result:', health);
  if (!health.healthy) {
    throw new Error('OpenCode Serve on 4096 is not healthy');
  }

  console.log('--- 2. Testing OpenCodeServeClient.getSessionsHttp ---');
  const sessions = await OpenCodeServeClient.getSessionsHttp('http://127.0.0.1:4096');
  console.log(`Found ${sessions.length} sessions from OpenCode Serve.`);
  if (sessions.length > 0) {
    console.log('First session sample:', {
      id: sessions[0].id,
      title: sessions[0].title?.slice(0, 40),
      agent: sessions[0].agent
    });
  }

  console.log('--- 3. Testing OpenCodeServeClient Instantiation (attach mode) ---');
  const attachClient = new OpenCodeServeClient({
    id: 'test-agent-attach',
    name: 'Test Attach Agent',
    type: 'worker',
    role: 'coder'
  }, {
    mode: 'attach',
    serverUrl: 'http://127.0.0.1:4096'
  });

  console.log('Client mode:', attachClient.getMode());
  console.log('Server URL:', attachClient.getServerUrl());
  console.log('Is busy:', attachClient.isBusy());

  console.log('--- 4. Testing OpenCodeServeClient Instantiation (http mode) ---');
  const httpClient = new OpenCodeServeClient({
    id: 'test-agent-http',
    name: 'Test HTTP Agent',
    type: 'worker',
    role: 'orchestrator'
  }, {
    mode: 'http',
    serverUrl: 'http://127.0.0.1:4096'
  });

  console.log('HTTP Client mode:', httpClient.getMode());
  console.log('HTTP Client server URL:', httpClient.getServerUrl());

  console.log('\nAll OpenCodeServeClient tests PASSED successfully!');
}

runTests().catch(err => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
