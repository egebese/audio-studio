const peaksCache = new Map<string, Promise<number[] | null>>();

export function bucketPeaks(channel: Float32Array, buckets: number): number[] {
  if (channel.length === 0 || buckets <= 0) return [];
  const bucketSize = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  for (let index = 0; index < buckets && index * bucketSize < channel.length; index += 1) {
    const start = index * bucketSize;
    const end = Math.min(channel.length, start + bucketSize);
    let max = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      const value = Math.abs(channel[cursor]);
      if (value > max) max = value;
    }
    peaks.push(max);
  }
  return peaks;
}

async function decodePeaks(url: string, buckets: number): Promise<number[] | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const offline = new OfflineAudioContext(1, 1, 44100);
  const decoded = await offline.decodeAudioData(bytes);
  return bucketPeaks(decoded.getChannelData(0), buckets);
}

export function loadPeaks(assetId: string, url: string, buckets = 200): Promise<number[] | null> {
  let pending = peaksCache.get(assetId);
  if (!pending) {
    // ponytail: in-memory cache only; recomputing peaks per session is cheap, persisting them is not worth it
    pending = decodePeaks(url, buckets).catch(() => null);
    peaksCache.set(assetId, pending);
  }
  return pending;
}
