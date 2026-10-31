/**
 * The one engagement number a tracked post is shown with: views or likes, chosen by the post's format.
 *
 * The app's database decides which count measures a format. `outlier_format_group` sorts a post into a format group and
 * `outlier_performance` scores Instagram images and carousels (and Threads) on likes and comments, because those posts
 * carry no view count (the scrape stores 0), and everything else on views. The outlier score is built on that, so every
 * MCP and CLI line that prints a post's number reads it from here, and a carousel never shows "0 views" beside an 18x
 * score. Port of the app's `lib/services/headline-metric.ts`: keep the two in step with the SQL function.
 */

export type OutlierFormatGroup = 'youtube_long' | 'youtube_short' | 'instagram_motion' | 'instagram_static' | 'threads'

export type HeadlineMetricKind = 'views' | 'likes'

export interface HeadlineMetric {
  kind: HeadlineMetricKind
  count: number
}

export interface HeadlineMetricInput {
  platform: string | null | undefined
  contentType: string | null | undefined
  viewCount: number | null | undefined
  likeCount: number | null | undefined
}

/** Mirror of the SQL `public.outlier_format_group`. Null for a platform or type the score does not cover. */
export function outlierFormatGroup(platform: string | null | undefined, contentType: string | null | undefined): OutlierFormatGroup | null {
  if (platform === 'youtube' && contentType === 'video') return 'youtube_long'
  if (platform === 'youtube' && contentType === 'short') return 'youtube_short'
  if (platform === 'instagram' && (contentType === 'reel' || contentType === 'video')) return 'instagram_motion'
  if (platform === 'instagram' && (contentType === 'image' || contentType === 'carousel')) return 'instagram_static'
  if (platform === 'threads') return 'threads'
  return null
}

/** The count a format is measured by, as `outlier_performance` measures it. */
function preferredKind(group: OutlierFormatGroup | null): HeadlineMetricKind {
  return group === 'instagram_static' || group === 'threads' ? 'likes' : 'views'
}

function countOf(item: HeadlineMetricInput, kind: HeadlineMetricKind): number | null {
  return (kind === 'views' ? item.viewCount : item.likeCount) ?? null
}

/**
 * The number to show for a post: the format's own count when it has one, else the other count when that is what the
 * platform gave (a reel with hidden views still has likes), else the format's count as a real zero. Null when the post
 * has neither count, so a line prints nothing rather than an invented 0.
 */
export function headlineMetric(item: HeadlineMetricInput): HeadlineMetric | null {
  const primary = preferredKind(outlierFormatGroup(item.platform, item.contentType))
  const secondary: HeadlineMetricKind = primary === 'views' ? 'likes' : 'views'
  const primaryCount = countOf(item, primary)
  const secondaryCount = countOf(item, secondary)
  if (primaryCount !== null && primaryCount > 0) return { kind: primary, count: primaryCount }
  if (secondaryCount !== null && secondaryCount > 0) return { kind: secondary, count: secondaryCount }
  if (primaryCount !== null) return { kind: primary, count: primaryCount }
  return null
}

/** The count the headline does not show, only when it is a real one. A carousel's stored 0 views is no count at all. */
export function secondaryMetric(item: HeadlineMetricInput): HeadlineMetric | null {
  const headline = headlineMetric(item)
  if (!headline) return null
  const kind: HeadlineMetricKind = headline.kind === 'views' ? 'likes' : 'views'
  const count = countOf(item, kind)
  return count !== null && count > 0 ? { kind, count } : null
}

function noun(metric: HeadlineMetric): string {
  const word = metric.kind === 'views' ? 'view' : 'like'
  return metric.count === 1 ? word : `${word}s`
}

/** Compact count (1.2M, 45.3K), the scale engagement counts are read at. */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** "4.2K likes", "1 view": the compact label for a metric. Null when there is none. */
export function formatMetric(metric: HeadlineMetric | null): string | null {
  return metric ? `${compactCount(metric.count)} ${noun(metric)}` : null
}

/** The full-precision label ("1,234 likes"), for text read in full. Null when there is none. */
export function formatMetricExact(metric: HeadlineMetric | null): string | null {
  return metric ? `${metric.count.toLocaleString('en-US')} ${noun(metric)}` : null
}
