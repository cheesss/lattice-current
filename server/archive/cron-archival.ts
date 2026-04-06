import { migrateHotRecordsToWarm, type HotCacheRecord } from './hot-warm-migrator';
import { archiveWarmRecords, type WarmRecord } from './warm-cold-archiver';

export async function runArchivalPipeline(args: {
  hotRecords: HotCacheRecord[];
  warmRecords: WarmRecord[];
  warmWriter: (record: HotCacheRecord) => Promise<{ inserted: boolean }>;
  keyPrefix: string;
  env?: Record<string, string | undefined>;
}) {
  const hotWarm = await migrateHotRecordsToWarm(args.hotRecords, args.warmWriter);
  const warmCold = await archiveWarmRecords('events', args.warmRecords, args.keyPrefix, args.env);
  return { hotWarm, warmCold };
}

