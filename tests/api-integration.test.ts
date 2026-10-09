import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../apps/api/dist/index.js';

test('API Integration - Full Server & Protected Stream Verification Flow', async () => {
  const server = await createServer();
  await server.ready();

  const authHeader = { Authorization: 'Bearer mock-admin-token' };

  // 1. Health Endpoint (Public)
  const healthRes = await server.inject({
    method: 'GET',
    url: '/api/health',
  });
  assert.equal(healthRes.statusCode, 200);
  const healthData = JSON.parse(healthRes.body);
  assert.equal(healthData.services.api, 'UP');

  // 2. Dashboard Summary (Protected)
  const dashboardRes = await server.inject({
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: authHeader,
  });
  assert.equal(dashboardRes.statusCode, 200);
  const summary = JSON.parse(dashboardRes.body);
  assert.ok(typeof summary.totalSources === 'number');

  // 3. Create a Local M3U Source
  const m3uContent = `#EXTM3U
#EXTINF:-1 tvg-id="test.1" tvg-name="Test One" group-title="TestGroup",Test Channel 1
https://example.com/test1.m3u8`;

  const addSourceRes = await server.inject({
    method: 'POST',
    url: '/api/sources',
    headers: authHeader,
    payload: {
      name: 'Integration Test Source',
      type: 'LOCAL_M3U',
      content: m3uContent,
      maxChannels: 10,
    },
  });

  assert.equal(addSourceRes.statusCode, 201);
  const addSourceData = JSON.parse(addSourceRes.body);
  assert.equal(addSourceData.importedChannels, 1);
  const sourceId = addSourceData.source.id;

  // 4. Verify Channel Imported
  const channelsRes = await server.inject({
    method: 'GET',
    url: `/api/channels?sourceId=${sourceId}`,
    headers: authHeader,
  });
  assert.equal(channelsRes.statusCode, 200);
  const channels = JSON.parse(channelsRes.body);
  assert.equal(channels.length, 1);
  const channel = channels[0];
  assert.equal(channel.name, 'Test Channel 1');

  // 5. Issue Protected Stream Token
  const tokenRes = await server.inject({
    method: 'POST',
    url: `/api/stream-tokens/channels/${channel.id}/tokens`,
    headers: authHeader,
    payload: {
      name: 'Test Client Token',
      lifetimeHours: 24,
    },
  });

  assert.equal(tokenRes.statusCode, 201);
  const tokenData = JSON.parse(tokenRes.body);
  const rawToken = tokenData.rawToken;
  const tokenDoc = tokenData.token;
  const publicOutputId = tokenDoc.publicOutputId;
  assert.ok(rawToken);
  assert.ok(tokenData.playbackUrl.includes(rawToken));

  // 6. Test Nginx HLS Auth Subrequest Endpoint (/api/hls-auth)
  // 6a. Valid Token -> Must return 200 OK
  const validSubreqRes = await server.inject({
    method: 'GET',
    url: `/api/hls-auth?outputId=${publicOutputId}&token=${rawToken}`,
  });
  assert.equal(validSubreqRes.statusCode, 200);

  // 6b. With X-Original-URI header (standard Nginx behavior)
  const nginxUriRes = await server.inject({
    method: 'GET',
    url: '/api/hls-auth',
    headers: {
      'x-original-uri': `/hls/${publicOutputId}/${rawToken}/segment_0001.ts`,
    },
  });
  assert.equal(nginxUriRes.statusCode, 200);

  // 6c. Invalid Token -> Must return 403 Forbidden
  const invalidSubreqRes = await server.inject({
    method: 'GET',
    url: `/api/hls-auth?outputId=${publicOutputId}&token=0000000000000000000000000000000000000000000000000000000000000000`,
  });
  assert.equal(invalidSubreqRes.statusCode, 403);

  // 7. Revoke Token
  const revokeRes = await server.inject({
    method: 'DELETE',
    url: `/api/stream-tokens/${tokenDoc.id}`,
    headers: authHeader,
  });
  assert.equal(revokeRes.statusCode, 200);

  // 8. Test Revoked Token Access -> Must immediately return 403 Forbidden!
  const revokedSubreqRes = await server.inject({
    method: 'GET',
    url: `/api/hls-auth?outputId=${publicOutputId}&token=${rawToken}`,
  });
  assert.equal(revokedSubreqRes.statusCode, 403);

  // Cleanup
  await server.close();
});
