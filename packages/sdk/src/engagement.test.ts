/**
 * A tracked post is shown with the count its format is measured by.
 *
 * ## The defect this encodes (2026-10-29)
 *
 * The MCP and CLI printed every post's views. Instagram images and carousels store 0 views, because the platform gives
 * none, and the outlier score measures them on likes and comments, so a carousel read "0 views" beside an 18x score.
 * The rule mirrors the app's SQL `outlier_format_group` and `outlier_performance`.
 *
 * ## Break-verified
 *
 * Measuring every format on views turns case 2 red; dropping the fallback to the other count turns case 3 red; printing
 * a stored 0 as the second count turns case 4 red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMetric, formatMetricExact, headlineMetric, outlierFormatGroup, secondaryMetric } from './engagement.js'

test('1. the format group mirrors the SQL function', () => {
  assert.equal(outlierFormatGroup('youtube', 'video'), 'youtube_long')
  assert.equal(outlierFormatGroup('youtube', 'short'), 'youtube_short')
  assert.equal(outlierFormatGroup('instagram', 'reel'), 'instagram_motion')
  assert.equal(outlierFormatGroup('instagram', 'video'), 'instagram_motion')
  assert.equal(outlierFormatGroup('instagram', 'image'), 'instagram_static')
  assert.equal(outlierFormatGroup('instagram', 'carousel'), 'instagram_static')
  assert.equal(outlierFormatGroup('threads', 'text'), 'threads')
  assert.equal(outlierFormatGroup('tiktok', 'video'), null)
})

test('2. images, carousels and Threads show likes; motion shows views', () => {
  assert.deepEqual(headlineMetric({ platform: 'instagram', contentType: 'carousel', viewCount: 0, likeCount: 4200 }), { kind: 'likes', count: 4200 })
  assert.deepEqual(headlineMetric({ platform: 'threads', contentType: 'text', viewCount: 900, likeCount: 12 }), { kind: 'likes', count: 12 })
  assert.deepEqual(headlineMetric({ platform: 'instagram', contentType: 'reel', viewCount: 50_000, likeCount: 900 }), { kind: 'views', count: 50_000 })
  assert.deepEqual(headlineMetric({ platform: 'youtube', contentType: 'video', viewCount: 1234, likeCount: 10 }), { kind: 'views', count: 1234 })
})

test('3. a missing format count falls back to the other, then to a real zero, then to nothing', () => {
  assert.deepEqual(headlineMetric({ platform: 'instagram', contentType: 'reel', viewCount: 0, likeCount: 300 }), { kind: 'likes', count: 300 })
  assert.deepEqual(headlineMetric({ platform: 'instagram', contentType: 'image', viewCount: 0, likeCount: 0 }), { kind: 'likes', count: 0 })
  assert.equal(headlineMetric({ platform: 'instagram', contentType: 'image', viewCount: null, likeCount: null }), null)
})

test('4. the second count is printed only when it is real', () => {
  assert.equal(secondaryMetric({ platform: 'instagram', contentType: 'carousel', viewCount: 0, likeCount: 4200 }), null)
  assert.deepEqual(secondaryMetric({ platform: 'instagram', contentType: 'reel', viewCount: 50_000, likeCount: 900 }), { kind: 'likes', count: 900 })
})

test('5. labels are compact or exact, singular at one', () => {
  assert.equal(formatMetric({ kind: 'likes', count: 4200 }), '4.2K likes')
  assert.equal(formatMetric({ kind: 'views', count: 1 }), '1 view')
  assert.equal(formatMetricExact({ kind: 'likes', count: 1234 }), '1,234 likes')
  assert.equal(formatMetric(null), null)
})
