import { QmeClient, type QmeClientOptions } from "@qme/client";
import { Qme as QmeRuntime } from "@qme/core";
import { QmeSdk, type QmeSdkOptions } from "@qme/sdk";

export class Qme extends QmeRuntime {
  static fromEnv(options: QmeSdkOptions = {}): QmeSdk {
    return new QmeSdk(options);
  }

  static connect(options: QmeClientOptions = {}): QmeClient {
    return new QmeClient(options);
  }
}

export { createApp } from "@qme/server/api";
export {
  EventBus,
  getStorePaths,
  QmeStore,
  WorkerPool
} from "@qme/core";
export type {
  BackoffKind,
  CommandAckState,
  DedupeScope,
  FlowRecord,
  FlowState,
  HandlerJobContext,
  JobCommandRecord,
  JobPayload,
  JobRecord,
  JobState,
  JobType,
  QmeEvent,
  QmeJobHandler,
  QueueState,
  RateLimitBucketRecord,
  RetryPolicy,
  StorePaths
} from "@qme/core";
export type {
  CreateFlowInput,
  CreateFlowJobOptions,
  CreateFlowResult,
  CreateJobInput,
  CreateJobOptions,
  QmeClientOptions,
  QueueRecord,
  RetryDelayInput,
  RetryPolicyInput,
  ScriptOptions
} from "@qme/client";
export type {
  AddFlowJobInput,
  QmeArtifactInput,
  QmeCommand,
  QmeContext,
  QmeJobResultInput,
  QmePollOptions,
  QmeSdkOptions,
  QmeSleepOptions,
  QmeTimeoutOptions
} from "@qme/sdk";
