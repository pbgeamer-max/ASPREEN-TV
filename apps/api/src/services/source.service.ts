import {
  Source,
  SourceCreateInput,
  parseM3UPlaylist,
  ParsedM3UChannel,
} from '@aspreen/shared';
import { validateUrlSsrf } from '@aspreen/shared/dist/server';
import { sourceRepository } from '../repositories/source.repository';
import { channelRepository } from '../repositories/channel.repository';
import { logRepository } from '../repositories/log.repository';
import { encrypt, decrypt } from '../security/encryption';
import { config } from '../config';

export class SourceService {
  async addSource(input: SourceCreateInput): Promise<{ source: Source; importedChannels: number }> {
    let sanitizedHostname = 'local-upload';
    let rawContent = '';

    if (input.type === 'LOCAL_M3U') {
      rawContent = input.content || '';
    } else {
      if (!input.url) {
        throw new Error('URL is required for M3U, M3U8, and TS sources');
      }

      // Perform strict SSRF validation
      const ssrfRes = await validateUrlSsrf(input.url);
      if (!ssrfRes.isValid) {
        throw new Error(`SSRF Validation Failed: ${ssrfRes.errorMessage || 'Invalid or forbidden URL'}`);
      }

      sanitizedHostname = ssrfRes.sanitizedHostname || 'unknown';

      // Fetch remote content for M3U playlists
      if (input.type === 'M3U') {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.sourceTimeoutSeconds * 1000);

        try {
          const fetchRes = await fetch(input.url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'AspreenTV/1.0',
              ...(input.customHeaders || {}),
            },
          });

          if (!fetchRes.ok) {
            throw new Error(`Failed to fetch remote playlist: HTTP ${fetchRes.status} ${fetchRes.statusText}`);
          }

          rawContent = await fetchRes.text();
        } catch (err: any) {
          throw new Error(`Connection error while fetching playlist: ${err.message}`);
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    // Encrypt sensitive URL and credentials
    const encryptedUrl = input.url ? encrypt(input.url) : '';
    const encryptedCredentials = input.credentials ? encrypt(input.credentials) : undefined;

    // Create Source entity in Firestore
    const source = await sourceRepository.createSource({
      name: input.name,
      type: input.type,
      sanitizedHostname,
      encryptedUrl,
      encryptedCredentials,
      enabled: true,
      connectionStatus: 'ONLINE',
      channelCount: 0,
      lastCheckedAt: new Date().toISOString(),
    });

    let importedCount = 0;

    if (input.type === 'M3U8' || input.type === 'TS') {
      // Single Direct Stream (M3U8 HLS or MPEG-TS) -> Create 1 Channel
      await channelRepository.createChannel({
        sourceId: source.id,
        name: input.name,
        normalizedName: input.name.toLowerCase().trim(),
        groupTitle: 'Direct Streams',
        inputType: input.type === 'TS' ? 'TS_STREAM' : 'HLS',
        encryptedInputUrl: encryptedUrl,
        enabled: true,
        inputStatus: 'ONLINE',
        transcodingStatus: 'STOPPED',
        preset: 'COPY',
      });
      importedCount = 1;
    } else if (rawContent) {
      // Parse M3U channel collection
      const parsed = parseM3UPlaylist(rawContent, {
        maxEntries: input.maxChannels || 10000,
        baseUrl: input.url,
      });

      const hostCache = new Map<string, boolean>();
      const channelsToCreate: any[] = [];

      for (const ch of parsed.channels) {
        if (!ch.url) continue;

        // Fast host cache for SSRF to avoid hundreds of redundant DNS lookups
        try {
          const u = new URL(ch.url);
          const host = u.hostname.toLowerCase();
          let isValid = hostCache.get(host);
          if (isValid === undefined) {
            const ssrf = await validateUrlSsrf(ch.url);
            isValid = ssrf.isValid;
            hostCache.set(host, isValid);
          }
          if (!isValid) continue;
        } catch {
          continue;
        }

        channelsToCreate.push({
          sourceId: source.id,
          externalIdentifier: ch.tvgId,
          name: ch.displayName,
          normalizedName: ch.displayName.toLowerCase().trim(),
          groupTitle: ch.groupTitle || 'General',
          logoUrl: ch.tvgLogo,
          inputType: ch.url.includes('.m3u8') ? 'HLS' : 'TS_STREAM',
          encryptedInputUrl: encrypt(ch.url),
          enabled: true,
          inputStatus: 'UNKNOWN',
          transcodingStatus: 'STOPPED',
          preset: 'COPY',
          orderIndex: channelsToCreate.length,
        });
      }

      importedCount = await channelRepository.createChannelsBatch(channelsToCreate);
    }

    // Update channelCount in source
    await sourceRepository.updateSource(source.id, {
      channelCount: importedCount,
      lastCheckedAt: new Date().toISOString(),
    });

    // Log activity
    await logRepository.addLog({
      eventType: 'SOURCE_CREATED',
      entityType: 'SOURCE',
      entityId: source.id,
      result: 'SUCCESS',
      safeDetails: {
        sourceName: source.name,
        type: source.type,
        hostname: sanitizedHostname,
        importedChannels: importedCount,
      },
    });

    return { source, importedChannels: importedCount };
  }

  async refreshSource(sourceId: string): Promise<{
    added: number;
    updated: number;
    total: number;
  }> {
    const source = await sourceRepository.getSource(sourceId);
    if (!source) throw new Error('Source not found');

    if (source.type !== 'M3U') {
      throw new Error('Only remote M3U sources can be refreshed from URL');
    }

    const decryptedUrl = decrypt(source.encryptedUrl);
    const ssrfRes = await validateUrlSsrf(decryptedUrl);
    if (!ssrfRes.isValid) {
      throw new Error(`SSRF check failed on source URL: ${ssrfRes.errorMessage}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.sourceTimeoutSeconds * 1000);

    let rawContent = '';
    try {
      const res = await fetch(decryptedUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'AspreenTV/1.0' },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      rawContent = await res.text();
    } finally {
      clearTimeout(timeout);
    }

    const parsed = parseM3UPlaylist(rawContent, {
      maxEntries: config.maxPlaylistChannels,
      baseUrl: decryptedUrl,
    });

    const existingChannels = await channelRepository.listChannels(sourceId, 2000);
    const existingByName = new Map(existingChannels.map((c) => [c.normalizedName, c]));

    let added = 0;
    let updated = 0;

    for (const ch of parsed.channels) {
      const normalized = ch.displayName.toLowerCase().trim();
      const existing = existingByName.get(normalized);

      if (existing) {
        // Update metadata while preserving active job & transcode settings
        await channelRepository.updateChannel(existing.id, {
          groupTitle: ch.groupTitle || existing.groupTitle,
          logoUrl: ch.tvgLogo || existing.logoUrl,
          encryptedInputUrl: encrypt(ch.url),
        });
        updated++;
      } else {
        const chSsrf = await validateUrlSsrf(ch.url);
        if (!chSsrf.isValid) continue;

        await channelRepository.createChannel({
          sourceId: source.id,
          externalIdentifier: ch.tvgId,
          name: ch.displayName,
          normalizedName: normalized,
          groupTitle: ch.groupTitle || 'General',
          logoUrl: ch.tvgLogo,
          inputType: ch.url.includes('.m3u8') ? 'HLS' : 'TS_STREAM',
          encryptedInputUrl: encrypt(ch.url),
          enabled: true,
          inputStatus: 'UNKNOWN',
          transcodingStatus: 'STOPPED',
          preset: 'COPY',
        });
        added++;
      }
    }

    const total = existingChannels.length + added;

    await sourceRepository.updateSource(source.id, {
      channelCount: total,
      lastCheckedAt: new Date().toISOString(),
      connectionStatus: 'ONLINE',
    });

    await logRepository.addLog({
      eventType: 'SOURCE_REFRESHED',
      entityType: 'SOURCE',
      entityId: source.id,
      result: 'SUCCESS',
      safeDetails: {
        sourceName: source.name,
        added,
        updated,
        total,
      },
    });

    return { added, updated, total };
  }
}

export const sourceService = new SourceService();
