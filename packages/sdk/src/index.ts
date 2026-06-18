/**
 * @contenthero/sdk
 *
 * Official SDK for the ContentHero Studio API: programmatic image, video, and
 * audio generation. The shared kernel the ContentHero MCP and CLI sit on.
 */

export { ContentHero } from './client.js'
export type { ContentHeroOptions, FetchLike } from './client.js'
export type {
  References,
  GenerateRequest,
  GenerateResult,
  CostEstimate,
  GenerateBoardRequest,
  BoardType,
  Generation,
  GenerationStatus,
  Balance,
  SubscriptionTier,
  WaitOptions,
  ModelKind,
  ModelCapabilities,
  ModelInfo,
  TranscribeRequest,
  Transcription,
  AvatarSummary,
  AvatarLook,
  Avatar,
  VoiceSummary,
  Voice,
  BrandKitSummary,
  BrandKitAccount,
  BrandKitSection,
  BrandKitKnowledge,
  BrandKit,
  MediaType,
  MediaVariation,
  MediaSummary,
  MediaItem,
  ListMediaOptions,
  PostPlatform,
  PostStatus,
  PipelineStage,
  PostSummary,
  PostAsset,
  PostDestination,
  PostDetail,
  PostListResult,
  ListPostsOptions,
  CreatePostInput,
  UpdatePostInput,
  AddDestinationInput,
  UpdateDestinationInput,
  AddAssetInput,
  PublishDestinationResult,
  PublishPostResult,
} from './types.js'
export {
  ContentHeroError,
  AuthenticationError,
  PermissionError,
  ValidationError,
  NotFoundError,
  InsufficientCreditsError,
  RateLimitError,
  GenerationFailedError,
  GenerationTimeoutError,
} from './errors.js'
export type { ContentHeroErrorOptions } from './errors.js'
