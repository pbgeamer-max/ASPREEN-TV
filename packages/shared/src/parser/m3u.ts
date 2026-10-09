import { ParsedM3UChannel, PlaylistParseResult } from '../types';

/**
 * Robust, production-grade M3U and M3U8 Playlist Parser.
 * Accurately parses channel collections, sanitizes metadata,
 * detects master/media HLS playlists vs channel collections,
 * and handles UTF-8 BOM, diverse newline formats, and malformed tags.
 */

export interface ParseOptions {
  maxEntries?: number;
  baseUrl?: string;
}

export function parseM3UPlaylist(content: string, options: ParseOptions = {}): PlaylistParseResult {
  const maxEntries = options.maxEntries ?? 2000;

  // Strip UTF-8 Byte Order Mark (BOM) if present
  let cleanContent = content;
  if (cleanContent.charCodeAt(0) === 0xfeff) {
    cleanContent = cleanContent.slice(1);
  }

  // Normalize line endings to \n
  const lines = cleanContent.split(/\r?\n/).map((l) => l.trim());

  // Check characteristics
  let isMasterPlaylist = false;
  let isMediaPlaylist = false;
  let isChannelCollection = false;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      isMasterPlaylist = true;
      break;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION') || line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      isMediaPlaylist = true;
      break;
    }
  }

  const channels: ParsedM3UChannel[] = [];
  let totalExtinfFound = 0;
  let validEntries = 0;
  let invalidEntries = 0;

  let currentMetadata: {
    tvgId?: string;
    tvgName?: string;
    tvgLogo?: string;
    groupTitle?: string;
    displayName: string;
    attributes: Record<string, string>;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line || line.length === 0) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      totalExtinfFound++;
      currentMetadata = parseExtinfLine(line);
      continue;
    }

    // Ignore other #EXT comments or directives
    if (line.startsWith('#')) {
      continue;
    }

    // If we reach a non-comment line, it should be a stream URL
    let streamUrl = line;

    // Resolve relative URL if baseUrl provided
    if (options.baseUrl && !/^https?:\/\//i.test(streamUrl)) {
      try {
        streamUrl = new URL(streamUrl, options.baseUrl).toString();
      } catch {
        // Leave as is if invalid
      }
    }

    // Must be a valid URL
    const isValidUrl = /^https?:\/\/[^\s]+$/i.test(streamUrl);

    if (isValidUrl) {
      validEntries++;
      const displayName = currentMetadata?.displayName?.trim() || `Channel ${validEntries}`;

      channels.push({
        displayName,
        url: streamUrl,
        tvgId: currentMetadata?.tvgId,
        tvgName: currentMetadata?.tvgName,
        tvgLogo: currentMetadata?.tvgLogo,
        groupTitle: currentMetadata?.groupTitle || 'General',
        rawAttributes: currentMetadata?.attributes,
      });

      if (channels.length >= maxEntries) {
        break;
      }
    } else {
      invalidEntries++;
    }

    // Reset currentMetadata for next entry
    currentMetadata = null;
  }

  if (channels.length > 0) {
    isChannelCollection = true;
  }

  return {
    isMasterPlaylist,
    isMediaPlaylist,
    isChannelCollection,
    channels,
    totalEntries: totalExtinfFound > 0 ? totalExtinfFound : channels.length + invalidEntries,
    validEntries,
    invalidEntries,
  };
}

/**
 * Parses a single #EXTINF line:
 * e.g. #EXTINF:-1 tvg-id="CNN.us" tvg-name="CNN US" tvg-logo="https://..." group-title="News",CNN HD
 */
function parseExtinfLine(line: string): {
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  displayName: string;
  attributes: Record<string, string>;
} {
  const content = line.substring(8); // Strip '#EXTINF:'
  const commaIndex = content.lastIndexOf(',');

  let metaPart = content;
  let displayName = 'Untitled Channel';

  if (commaIndex !== -1) {
    metaPart = content.substring(0, commaIndex).trim();
    displayName = content.substring(commaIndex + 1).trim() || 'Untitled Channel';
  }

  const attributes: Record<string, string> = {};

  // Extract key="value" or key=value pairs
  const attrRegex = /([a-zA-Z0-9_\-:]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(metaPart)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[key] = val;
  }

  return {
    tvgId: attributes['tvg-id'] || attributes['tvg_id'],
    tvgName: attributes['tvg-name'] || attributes['tvg_name'],
    tvgLogo: attributes['tvg-logo'] || attributes['tvg_logo'],
    groupTitle: attributes['group-title'] || attributes['group_title'] || attributes['group'],
    displayName,
    attributes,
  };
}
